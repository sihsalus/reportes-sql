/**
 * SQL generation coverage for the current TypeScript engine.
 *
 * Legacy note: the old Python engine used %(name)s placeholders; mysql2 uses :name.
 */
import { buildQuery } from "../src/engine/interpreter";
import {
  FiltrosEventoSchema,
  FiltrosPoblacionSchema,
  FiltroDiagnosticoSchema,
  FiltroOrdenSchema,
  parseDefinicionIndicador,
  parseFiltrosPoblacion,
} from "../src/types/definicion";
import type { FiltrosEvento, FiltroDiagnostico, FiltroOrden } from "../src/types/definicion";

const UUID_LOC = "12345678-1234-1234-1234-123456789abc";
const UUID_DIAG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const UUID_DIAG2 = "11111111-2222-3333-4444-555555555555";
const UUID_ORD = "ffffffff-gggg-hhhh-iiii-jjjjjjjjjjjj";
const INICIO = new Date("2026-04-01");
const FIN = new Date("2026-04-30");

function makeEvento(props: Partial<FiltrosEvento> = {}): FiltrosEvento {
  return FiltrosEventoSchema.parse({
    location_uuids: [UUID_LOC],
    ...props,
  });
}

describe("BuildQuery", () => {
  test("minimal query — conteo_atenciones with location", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("COUNT(*)");
    expect(sql).toContain("location");
  });

  test("conteo_pacientes", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_pacientes",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("COUNT(DISTINCT");
  });

  test("minimo_ocurrencias adds subquery", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        minimo_ocurrencias: 3,
      },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("HAVING");
  });

  test("diagnosticos join and filter", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [
          { concepto_uuids: [UUID_DIAG], tipo_diagnostico: "definitivo" },
        ],
      },
    });
    const { sql, params } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("encounter_diagnosis");
    expect(sql).toContain("concept c");
    expect(sql).toContain("c.uuid IN");
    expect(sql).toContain("ed.certainty");
    expect(Object.values(params)).toContain("CONFIRMED");
  });

  test("diagnosticos presuntivo", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [
          { concepto_uuids: [UUID_DIAG], tipo_diagnostico: "presuntivo" },
        ],
      },
    });
    const { sql, params } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("ed.certainty");
    expect(Object.values(params)).toContain("PROVISIONAL");
  });

  test("diagnosticos empty uuids omits concept filter", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [
          { concepto_uuids: [], tipo_diagnostico: "definitivo" },
        ],
      },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("ed.certainty");
    expect(sql).not.toContain("c.uuid IN");
  });

  test("diagnosticos multiple uuids OR logic", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [{ concepto_uuids: [UUID_DIAG, UUID_DIAG2] }],
      },
    });
    const { sql, params } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("c.uuid IN (:diag_uuid_0_0, :diag_uuid_0_1)");
    expect(params["diag_uuid_0_0"]).toBe(UUID_DIAG);
    expect(params["diag_uuid_0_1"]).toBe(UUID_DIAG2);
  });

  test("diagnosticos single uuid uses paren placeholder", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [
          { concepto_uuids: [UUID_DIAG], tipo_diagnostico: "definitivo" },
        ],
      },
    });
    const { sql, params } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("c.uuid IN (:diag_uuid_0_0)");
    expect(params["diag_uuid_0_0"]).toBe(UUID_DIAG);
  });

  test("diagnosticos no match omits filter", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        diagnosticos: [{ concepto_uuids: [] }],
      },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).not.toContain("encounter_diagnosis");
  });

  test("ordenes generates EXISTS", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        ordenes: [{ concepto_uuid: UUID_ORD }],
      },
    });
    const conceptMap = { [UUID_ORD]: 42 };
    const { sql } = buildQuery(definicion, INICIO, FIN, conceptMap);
    expect(sql).toContain("EXISTS");
    expect(sql).toContain("orders");
  });

  test("ordenes multiple AND logic", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        ordenes: [
          { concepto_uuid: UUID_ORD },
          { concepto_uuid: "uuid-2" },
        ],
      },
    });
    const conceptMap = { [UUID_ORD]: 42, "uuid-2": 99 };
    const { sql } = buildQuery(definicion, INICIO, FIN, conceptMap);
    expect(sql.match(/EXISTS/g)?.length).toBe(2);
    expect(sql).toContain("orders o0");
    expect(sql).toContain("orders o1");
  });

  test("ordenes no concept_map omits", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        ordenes: [{ concepto_uuid: UUID_ORD }],
      },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).not.toContain("orders");
  });

  test("no obs table references", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        ordenes: [{ concepto_uuid: UUID_ORD }],
      },
    });
    const conceptMap = { [UUID_ORD]: 42 };
    const { sql } = buildQuery(definicion, INICIO, FIN, conceptMap);
    expect(sql).not.toContain("obs");
  });

  test("poblacion age filter adds person join", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
      poblacion: { min_dias: 1 },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("JOIN");
  });

  test("no evento returns valid SQL", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(typeof sql).toBe("string");
    expect(sql.length).toBeGreaterThan(0);
  });

  test("minimo_ocurrencias with diagnosticos", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        minimo_ocurrencias: 3,
        diagnosticos: [
          { concepto_uuids: [UUID_DIAG], tipo_diagnostico: "definitivo" },
        ],
      },
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("HAVING");
    expect(sql).toContain("encounter_diagnosis");
  });

  test("minimo_ocurrencias with ordenes", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        minimo_ocurrencias: 3,
        ordenes: [{ concepto_uuid: UUID_ORD }],
      },
    });
    const conceptMap = { [UUID_ORD]: 42 };
    const { sql } = buildQuery(definicion, INICIO, FIN, conceptMap);
    expect(sql).toContain("HAVING");
    expect(sql).toContain("orders");
  });

  test("no location join when empty", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {},
    });
    const { sql } = buildQuery(definicion, INICIO, FIN);
    expect(sql).not.toContain("JOIN location");
  });

  test("location join and where with two uuids", () => {
    const definicion = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC, "uuid-loc-2"],
      },
    });
    const { sql, params } = buildQuery(definicion, INICIO, FIN);
    expect(sql).toContain("JOIN location l ON e.location_id = l.location_id");
    expect(sql).toContain("l.uuid IN");
    expect(Object.keys(params).some((k) => k.startsWith("loc_"))).toBe(true);
  });
});

// ── Fecha bounds exclusive ────────────────────────────────────────────

describe("FechaBoundsExclusive", () => {
  test("conteo_atenciones uses ge and lt", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).not.toContain("BETWEEN");
    expect(sql).toContain("e.encounter_datetime >= :inicio");
    expect(sql).toContain("e.encounter_datetime < :fin_excl");
  });

  test("conteo_pacientes uses ge and lt", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_pacientes",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).not.toContain("BETWEEN");
    expect(sql).toContain("e.encounter_datetime >= :inicio");
    expect(sql).toContain("e.encounter_datetime < :fin_excl");
  });

  test("subquery uses ge and lt", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        minimo_ocurrencias: 3,
      },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).not.toContain("BETWEEN");
    expect(sql).toContain("e.encounter_datetime >= :inicio");
    expect(sql).toContain("e.encounter_datetime < :fin_excl");
  });

  test("params contain fin_excl not fin", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { params } = buildQuery(d, INICIO, FIN);
    expect(params).toHaveProperty("fin_excl");
    expect(params).not.toHaveProperty("fin");
    expect(params["inicio"]).toBe("2026-04-01");
  });

  test("fin_excl is inicio plus one day", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { params } = buildQuery(d, INICIO, FIN);
    expect(params["fin_excl"]).toBe("2026-05-01");
  });

  test("fin_excl correct for conteo_pacientes", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_pacientes",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { params } = buildQuery(d, INICIO, FIN);
    expect(params["fin_excl"]).toBe("2026-05-01");
  });

  test("fin_excl correct for subquery", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: {
        location_uuids: [UUID_LOC],
        minimo_ocurrencias: 3,
      },
    });
    const { params } = buildQuery(d, INICIO, FIN);
    expect(params["fin_excl"]).toBe("2026-05-01");
  });
});

// ── Age filter SQL generation ────────────────────────────────────────

describe("AgeFilterSQL", () => {
  test("min_dias generates DATEDIFF ge", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_dias: 1 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain("DATEDIFF");
    expect(sql).toContain("p.birthdate");
    expect(sql).toContain("DATEDIFF(:inicio, p.birthdate) >= :min_dias");
    expect(params["min_dias"]).toBe(1);
  });

  test("min_dias sql contains ge operator", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_dias: 30 },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATEDIFF(:inicio, p.birthdate) >= :min_dias",
    );
  });

  test("max_dias generates DATEDIFF le", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { max_dias: 365 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATEDIFF(:inicio, p.birthdate) <= :max_dias",
    );
    expect(params["max_dias"]).toBe(365);
  });

  test("min_meses uses DATE_ADD month", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_meses: 6 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :min_meses MONTH)",
    );
    expect(params["min_meses"]).toBe(6);
  });

  test("min_meses compare le inicio", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_meses: 12 },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :min_meses MONTH) <= :inicio",
    );
  });

  test("min_anios uses DATE_ADD year", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_anios: 18 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :min_anios YEAR)",
    );
    expect(params["min_anios"]).toBe(18);
  });

  test("max_meses_excl uses DATE_ADD gt", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { max_meses_excl: 6 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :max_meses_excl MONTH)",
    );
    expect(sql).toContain("> :inicio");
    expect(params["max_meses_excl"]).toBe(6);
  });

  test("max_meses_excl is exclusive", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { max_meses_excl: 12 },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :max_meses_excl MONTH) > :inicio",
    );
  });

  test("max_anios_excl uses DATE_ADD year gt", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { max_anios_excl: 5 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :max_anios_excl YEAR)",
    );
    expect(sql).toContain("> :inicio");
    expect(params["max_anios_excl"]).toBe(5);
  });

  test("max_anios_excl is exclusive", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { max_anios_excl: 18 },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :max_anios_excl YEAR) > :inicio",
    );
  });

  test("both bounds min_dias max_anios_excl", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { min_dias: 30, max_anios_excl: 5 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain("DATEDIFF");
    expect(sql).toContain("DATE_ADD");
    expect(params["min_dias"]).toBe(30);
    expect(params["max_anios_excl"]).toBe(5);
  });

  test("no age filter no person join for age", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
    });
    const { sql } = buildQuery(d, INICIO, FIN);
    expect(sql).not.toContain("JOIN person");
  });

  test("sexo only still adds person join in conteo_pacientes", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_pacientes",
      periodo: "mes_actual",
      evento: { location_uuids: [UUID_LOC] },
      poblacion: { sexo: "F" },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain("p.gender");
    expect(params["sexo"]).toBe("F");
  });

  test("legacy edad_min_dias through interpreter", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { edad_min_dias: 1 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATEDIFF(:inicio, p.birthdate) >= :min_dias",
    );
    expect(params["min_dias"]).toBe(1);
  });

  test("legacy edad_max_anios through interpreter", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
      poblacion: { edad_max_anios: 5 },
    });
    const { sql, params } = buildQuery(d, INICIO, FIN);
    expect(sql).toContain(
      "DATE_ADD(p.birthdate, INTERVAL :max_anios_excl YEAR) > :inicio",
    );
    expect(params["max_anios_excl"]).toBe(5);
  });
});
