import { buildQuery } from "../src/engine/interpreter.js";
import { parseDefinicionIndicador } from "../src/types/definicion.js";
import { writeFileSync } from "fs";

const INICIO = new Date("2026-04-01");
const FIN = new Date("2026-04-30");
const LOC = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
];
const DIAG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ORD = "ffffffff-1111-2222-3333-444444444444";

const cases = [
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC, diagnosticos: [{ concepto_uuids: [DIAG], tipo_diagnostico: "definitivo" }] } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC, ordenes: [{ concepto_uuid: ORD }] } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC, minimo_ocurrencias: 3 } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC, minimo_ocurrencias: 3, ordenes: [{ concepto_uuid: ORD }] } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC }, poblacion: { sexo: "F", min_anios: 18, max_anios_excl: 65 } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC }, poblacion: { min_dias: 30 } },
  { tipo: "conteo_atenciones", evento: { location_uuids: LOC, minimo_ocurrencias: 2 }, poblacion: { sexo: "M", min_meses: 6 } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, diagnosticos: [{ concepto_uuids: [DIAG] }] } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, ordenes: [{ concepto_uuid: ORD }] } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, minimo_ocurrencias: 5 } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC }, poblacion: { sexo: "F" } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC }, poblacion: { max_dias: 365 } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, minimo_ocurrencias: 3, diagnosticos: [{ concepto_uuids: [DIAG], tipo_diagnostico: "presuntivo" }] }, poblacion: { min_anios: 18, sexo: "M" } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, minimo_ocurrencias: 2 }, poblacion: { max_meses_excl: 60 } },
  { tipo: "conteo_atenciones", evento: {} },
  { tipo: "conteo_atenciones" },
  { tipo: "conteo_pacientes", evento: { diagnosticos: [{ concepto_uuids: [DIAG], tipo_diagnostico: "definitivo" }] }, poblacion: { min_anios: 18, max_anios_excl: 65, sexo: "F" } },
  { tipo: "conteo_pacientes", evento: { location_uuids: LOC, minimo_ocurrencias: 2 }, poblacion: { sexo: "F" } },
];

const cm: Record<string, number> = { [ORD]: 999 };

test("snapshot SQL + params keys for all cases", () => {
  const lines: string[] = [];
  for (const c of cases) {
    const d = parseDefinicionIndicador(c);
    for (const withCm of [false, true]) {
      let r: { sql: string; params: Record<string, unknown> } | { error: string };
      try {
        r = buildQuery(d, INICIO, FIN, withCm ? cm : undefined);
      } catch (e) {
        r = { error: e instanceof Error ? e.message : String(e) };
      }
      lines.push("=== " + JSON.stringify(c) + " cm=" + withCm + " ===");
      if ("error" in r) {
        lines.push("ERROR " + r.error);
      } else {
        lines.push(r.sql);
        lines.push("KEYS " + JSON.stringify(Object.keys(r.params)));
        lines.push("VALS " + JSON.stringify(r.params));
      }
      lines.push("");
    }
  }
  writeFileSync("/tmp/opencode/interp_OUT.txt", "___INTERP_SNAPSHOT_BEGIN___\n" + lines.join("\n") + "\n___INTERP_SNAPSHOT_END___\n");
  expect(lines.length).toBeGreaterThan(0);
});