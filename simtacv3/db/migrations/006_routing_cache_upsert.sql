-- 006_routing_cache_upsert.sql
--
-- Corrige el defecto de caché de ruta vehicular documentado en
-- INTEGRACION_SIMTAC_GEOSERVER.md e INTEGRACION_RED_LOCAL_MAC.md §7:
--
--   HTTP 400 duplicate key value violates unique constraint "simtac_ruta_cache_pkey"
--
-- al repetir exactamente el mismo par de coordenadas (a 6 decimales) cuya fila
-- de caché ya venció (>7 días): la función SQL de caché hace INSERT sin
-- ON CONFLICT, así que en vez de refrescar la fila choca contra su propia PK.
--
-- La corrección convierte ese INSERT en un upsert idempotente
-- (INSERT ... ON CONFLICT (<pk>) DO UPDATE SET ...), de modo que una fila
-- vencida se refresca en lugar de colisionar.
--
-- Se aplica sobre la definición viva de la función en vez de reescribirla
-- completa a mano: así la migración no depende de la versión exacta del cuerpo
-- desplegado (origen y réplica pueden diferir) y no pisa cambios ajenos.
-- Es idempotente: si la función ya trae ON CONFLICT, no hace nada.
-- Si no puede aplicar el cambio con seguridad, falla ruidosamente y hace
-- ROLLBACK — nunca deja la función a medias.
--
-- Aplicar con:  psql -v ON_ERROR_STOP=1 -f 006_routing_cache_upsert.sql
-- La definición anterior queda en el log (RAISE NOTICE) para poder revertir.

BEGIN;

DO $migracion$
DECLARE
    v_oid        oid;
    v_def        text;
    v_nueva      text;
    v_tabla      regclass;
    v_pk_col     text;
    v_pk_cols    int;
    v_set_list   text;
    v_ini        int;
    v_largo_stmt int;
    v_resto      text;
    v_stmt       text;
BEGIN
    -- 1. La tabla de caché tiene que existir y tener PK de una sola columna.
    SELECT c.oid::regclass INTO v_tabla
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'simtac_ruta_cache'
       AND c.relkind = 'r'
     ORDER BY (n.nspname = current_schema()) DESC, c.oid
     LIMIT 1;

    IF v_tabla IS NULL THEN
        RAISE EXCEPTION 'No existe la tabla simtac_ruta_cache en esta base: ¿es la base de PostGIS/pgRouting del GeoServer?';
    END IF;

    SELECT count(*), min(a.attname)
      INTO v_pk_cols, v_pk_col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = v_tabla
       AND i.indisprimary;

    IF v_pk_cols IS NULL OR v_pk_cols = 0 THEN
        RAISE EXCEPTION 'simtac_ruta_cache no tiene PRIMARY KEY: nada contra lo que hacer ON CONFLICT.';
    ELSIF v_pk_cols > 1 THEN
        RAISE EXCEPTION 'simtac_ruta_cache tiene una PK compuesta (% columnas); revisar a mano.', v_pk_cols;
    END IF;

    -- 2. Buscar la función de caché.
    SELECT p.oid, pg_get_functiondef(p.oid)
      INTO v_oid, v_def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'simtac_calcular_ruta_resumen'
     ORDER BY (n.nspname = current_schema()) DESC, p.oid
     LIMIT 1;

    IF v_def IS NULL THEN
        RAISE EXCEPTION 'No existe la función simtac_calcular_ruta_resumen en esta base.';
    END IF;

    -- 3. Idempotencia.
    IF v_def ~* '\mon\s+conflict\M' THEN
        RAISE NOTICE '006: simtac_calcular_ruta_resumen ya tiene ON CONFLICT; no se cambia nada.';
        RETURN;
    END IF;

    -- 4. Aislar la sentencia INSERT de la caché.
    v_ini := position('insert into' in lower(v_def));
    IF v_ini = 0 THEN
        RAISE EXCEPTION '006: la función no contiene ningún INSERT INTO; revisar a mano.';
    END IF;

    v_resto      := substr(v_def, v_ini);
    v_largo_stmt := position(';' in v_resto);
    IF v_largo_stmt = 0 THEN
        RAISE EXCEPTION '006: no se encontró el fin (;) del INSERT; revisar a mano.';
    END IF;

    v_stmt := substr(v_resto, 1, v_largo_stmt - 1);

    IF v_stmt !~* 'simtac_ruta_cache' THEN
        RAISE EXCEPTION '006: el primer INSERT de la función no escribe en simtac_ruta_cache; revisar a mano.';
    END IF;
    IF v_stmt ~ '''' THEN
        RAISE EXCEPTION '006: el INSERT contiene literales de texto y el corte por ";" no es fiable; revisar a mano.';
    END IF;

    -- 5. SET de todas las columnas menos la PK.
    SELECT string_agg(format('%I = EXCLUDED.%I', a.attname, a.attname), ', ' ORDER BY a.attnum)
      INTO v_set_list
      FROM pg_attribute a
     WHERE a.attrelid = v_tabla
       AND a.attnum > 0
       AND NOT a.attisdropped
       AND a.attname <> v_pk_col;

    IF v_set_list IS NULL THEN
        RAISE EXCEPTION '006: simtac_ruta_cache solo tiene la columna PK; nada que actualizar.';
    END IF;

    -- 6. Reescribir la función con el upsert.
    v_nueva := substr(v_def, 1, v_ini - 1)
            || v_stmt
            || format(E'\n    ON CONFLICT (%I) DO UPDATE SET %s', v_pk_col, v_set_list)
            || substr(v_resto, v_largo_stmt);

    RAISE NOTICE E'006: definición anterior de simtac_calcular_ruta_resumen (para revertir):\n%', v_def;
    EXECUTE v_nueva;

    -- 7. Verificar que quedó aplicado.
    IF pg_get_functiondef(v_oid) !~* '\mon\s+conflict\M' THEN
        RAISE EXCEPTION '006: la reescritura no dejó el ON CONFLICT en la función; se revierte.';
    END IF;

    RAISE NOTICE '006: simtac_calcular_ruta_resumen ahora hace upsert sobre %.%I.', v_tabla, v_pk_col;
END
$migracion$;

COMMIT;

-- Verificación manual, desde fuera de la base (sustituir HOST):
--
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     "http://172.200.1.17:3001/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature\
-- &typeName=simtac_general:simtac_ruta_calculada&outputFormat=application/json\
-- &viewparams=origen_lon:-99.133200;origen_lat:19.432600;destino_lon:-99.653200;destino_lat:19.292600"
--
-- Repetir la misma llamada dos veces: ambas deben devolver 200.
