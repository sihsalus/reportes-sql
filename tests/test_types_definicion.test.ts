/**
 * Zod validation coverage for the current TypeScript schemas.
 *
 * Legacy note: these cases preserve behavior from the removed Python implementation.
 */
import {
  DefinicionIndicadorSchema,
  FiltrosEventoSchema,
  FiltrosPoblacionSchema,
  FiltroDiagnosticoSchema,
  FiltroOrdenSchema,
  parseDefinicionIndicador,
  parseFiltrosPoblacion,
  parseFiltrosEvento,
  hasAgeFilter,
} from "../src/types/definicion";
import { ZodError } from "zod";

describe("DefinicionIndicador", () => {
  test("minimal valid — tipo only (periodo is now optional)", () => {
    const d = DefinicionIndicadorSchema.parse({
      tipo: "conteo_atenciones",
    });
    expect(d.tipo).toBe("conteo_atenciones");
    expect(d.periodo).toBeUndefined();
    expect(d.evento).toBeUndefined();
  });

  test("periodo still accepted for backward compat (optional)", () => {
    const d = DefinicionIndicadorSchema.parse({
      tipo: "conteo_atenciones",
      periodo: "mes_actual",
    });
    expect(d.tipo).toBe("conteo_atenciones");
    expect(d.periodo).toBe("mes_actual");
  });

  test("full with diagnosticos (no periodo required)", () => {
    const d = DefinicionIndicadorSchema.parse({
      tipo: "conteo_atenciones",
      poblacion: { max_dias: 1825 },
      evento: {
        location_uuids: ["uuid-consulta-externa"],
        diagnosticos: [
          {
            concepto_uuids: ["uuid-diag-1"],
            tipo_diagnostico: "definitivo",
          },
        ],
      },
    });
    expect(d.evento).toBeDefined();
    expect(d.evento!.diagnosticos).toBeDefined();
    expect(d.evento!.diagnosticos![0].concepto_uuids).toEqual(["uuid-diag-1"]);
    expect(d.evento!.diagnosticos![0].tipo_diagnostico).toBe("definitivo");
  });

  test("full with ordenes (no periodo required)", () => {
    const d = DefinicionIndicadorSchema.parse({
      tipo: "conteo_pacientes",
      evento: {
        location_uuids: ["uuid-consulta-externa"],
        ordenes: [
          { concepto_uuid: "uuid-order-1" },
          { concepto_uuid: "uuid-order-2" },
        ],
      },
    });
    expect(d.evento).toBeDefined();
    expect(d.evento!.ordenes).toBeDefined();
    expect(d.evento!.ordenes!.length).toBe(2);
    expect(d.evento!.ordenes![0].concepto_uuid).toBe("uuid-order-1");
  });

  test("invalid tipo rejected", () => {
    expect(() =>
      DefinicionIndicadorSchema.parse({
        tipo: "invalido",
      }),
    ).toThrow(ZodError);
  });

  test("invalid minimo_ocurrencias rejected", () => {
    expect(() =>
      FiltrosEventoSchema.parse({
        location_uuids: ["uuid-x"],
        minimo_ocurrencias: 0,
      }),
    ).toThrow(ZodError);
  });

  test("poblacion has_age_filter", () => {
    const p = FiltrosPoblacionSchema.parse({ min_dias: 1 });
    expect(hasAgeFilter(p)).toBe(true);

    const p2 = FiltrosPoblacionSchema.parse({});
    expect(hasAgeFilter(p2)).toBe(false);
  });
});

describe("MutualExclusivity", () => {
  test("only diagnosticos passes", () => {
    const ev = FiltrosEventoSchema.parse({
      location_uuids: ["uuid-x"],
      diagnosticos: [{ concepto_uuids: ["uuid-d"] }],
    });
    expect(ev.diagnosticos).toBeDefined();
    expect(ev.ordenes).toBeUndefined();
  });

  test("only ordenes passes", () => {
    const ev = FiltrosEventoSchema.parse({
      location_uuids: ["uuid-x"],
      ordenes: [{ concepto_uuid: "uuid-o" }],
    });
    expect(ev.ordenes).toBeDefined();
    expect(ev.diagnosticos).toBeUndefined();
  });

  test("neither passes", () => {
    const ev = FiltrosEventoSchema.parse({ location_uuids: ["uuid-x"] });
    expect(ev.diagnosticos).toBeUndefined();
    expect(ev.ordenes).toBeUndefined();
  });

  test("both set fails", () => {
    expect(() =>
      FiltrosEventoSchema.parse({
        location_uuids: ["uuid-x"],
        diagnosticos: [{ concepto_uuids: ["uuid-d"] }],
        ordenes: [{ concepto_uuid: "uuid-o" }],
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("both inside definicion fails", () => {
    expect(() =>
      DefinicionIndicadorSchema.parse({
        tipo: "conteo_atenciones",
        evento: {
          location_uuids: ["uuid-x"],
          diagnosticos: [{ concepto_uuids: ["uuid-d"] }],
          ordenes: [{ concepto_uuid: "uuid-o" }],
        },
      }),
    ).toThrow(/mutually exclusive/);
  });
});

describe("BackwardCompatNormalizer", () => {
  test("old flat diagnostico normalizes", () => {
    const old = {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-x"] },
      diagnostico: {
        codigos_cie10: ["J00.X", "J04.0"],
        tipo_diagnostico: "definitivo",
      },
    };
    const d = parseDefinicionIndicador(old);
    expect(d.evento).toBeDefined();
    expect(d.evento!.diagnosticos).toBeDefined();
    expect(d.evento!.diagnosticos!.length).toBe(1);
    expect(d.evento!.diagnosticos![0].concepto_uuids).toEqual([]);
    expect(d.evento!.diagnosticos![0].tipo_diagnostico).toBe("definitivo");
  });

  test("old flat observaciones normalizes to ordenes", () => {
    const old = {
      tipo: "conteo_pacientes",
      evento: { location_uuids: ["uuid-x"] },
      observaciones: [
        { concepto_uuid: "uuid-a" },
        { concepto_uuid: "uuid-b" },
      ],
    };
    const d = parseDefinicionIndicador(old);
    expect(d.evento).toBeDefined();
    expect(d.evento!.ordenes).toBeDefined();
    expect(d.evento!.ordenes!.length).toBe(2);
    expect(d.evento!.ordenes![0].concepto_uuid).toBe("uuid-a");
    expect(d.evento!.ordenes![1].concepto_uuid).toBe("uuid-b");
  });

  test("old flat both diagnostico and observaciones are mutually exclusive", () => {
    const old = {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-x"] },
      diagnostico: { tipo_diagnostico: "definitivo" },
      observaciones: [{ concepto_uuid: "uuid-a" }],
    };
    expect(() => parseDefinicionIndicador(old)).toThrow(
      /mutually exclusive/,
    );
  });

  test("new nested passes through unchanged", () => {
    const newData = {
      tipo: "conteo_atenciones",
      evento: {
        location_uuids: ["uuid-x"],
        diagnosticos: [
          {
            concepto_uuids: ["uuid-d"],
            tipo_diagnostico: "presuntivo",
          },
        ],
      },
    };
    const d = parseDefinicionIndicador(newData);
    expect(d.evento).toBeDefined();
    expect(d.evento!.diagnosticos).toBeDefined();
    expect(d.evento!.diagnosticos![0].concepto_uuids).toEqual(["uuid-d"]);
  });

  test("idempotent double parse", () => {
    const old = {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-x"] },
      observaciones: [{ concepto_uuid: "uuid-a" }],
    };
    const d1 = parseDefinicionIndicador(old);
    const dump1 = JSON.parse(JSON.stringify(d1));
    const d2 = parseDefinicionIndicador(dump1);
    const dump2 = JSON.parse(JSON.stringify(d2));
    expect(dump1).toEqual(dump2);
  });

  test("old eventos array picks first", () => {
    const old = {
      tipo: "conteo_atenciones",
      eventos: [
        { location_uuids: ["uuid-first"] },
        { location_uuids: ["uuid-second"] },
      ],
    };
    const d = parseDefinicionIndicador(old);
    expect(d.evento).toBeDefined();
    expect(d.evento!.location_uuids).toEqual(["uuid-first"]);
  });

  test("old diagnostico no tipo skips", () => {
    const old = {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-x"] },
      diagnostico: { codigos_cie10: ["J00.X"] },
    };
    const d = parseDefinicionIndicador(old);
    expect(d.evento).toBeDefined();
    expect(d.evento!.diagnosticos).toBeUndefined();
  });
});

describe("FiltroDiagnosticoValidation", () => {
  test("valid concepto_uuids", () => {
    const fd = FiltroDiagnosticoSchema.parse({
      concepto_uuids: ["uuid-abc"],
    });
    expect(fd.concepto_uuids).toEqual(["uuid-abc"]);
    expect(fd.tipo_diagnostico).toBeUndefined();
  });

  test("valid with tipo", () => {
    const fd = FiltroDiagnosticoSchema.parse({
      concepto_uuids: ["uuid-abc"],
      tipo_diagnostico: "definitivo",
    });
    expect(fd.tipo_diagnostico).toBe("definitivo");
  });

  test("valid empty concepto_uuids", () => {
    const fd = FiltroDiagnosticoSchema.parse({});
    expect(fd.concepto_uuids).toEqual([]);
  });

  test("valid multiple uuids", () => {
    const fd = FiltroDiagnosticoSchema.parse({
      concepto_uuids: ["uuid-a", "uuid-b"],
    });
    expect(fd.concepto_uuids.length).toBe(2);
  });

  test("invalid tipo rejected", () => {
    expect(() =>
      FiltroDiagnosticoSchema.parse({
        concepto_uuids: ["uuid-abc"],
        tipo_diagnostico: "invalido",
      }),
    ).toThrow(ZodError);
  });
});

describe("FiltroOrdenValidation", () => {
  test("valid concepto_uuid", () => {
    const fo = FiltroOrdenSchema.parse({ concepto_uuid: "uuid-order" });
    expect(fo.concepto_uuid).toBe("uuid-order");
  });

  test("empty concepto_uuid rejected", () => {
    expect(() => FiltroOrdenSchema.parse({ concepto_uuid: "" })).toThrow(
      ZodError,
    );
  });
});

// ── Phase 1: Canonical six-field age filter ───────────────────────────

describe("FiltrosPoblacionCanonical", () => {
  test("canonical min_dias valid", () => {
    const p = FiltrosPoblacionSchema.parse({ min_dias: 30, sexo: "F" });
    expect(p.min_dias).toBe(30);
    expect(p.min_meses).toBeUndefined();
    expect(p.min_anios).toBeUndefined();
    expect(p.sexo).toBe("F");
  });

  test("canonical max_anios_excl valid", () => {
    const p = FiltrosPoblacionSchema.parse({ max_anios_excl: 5 });
    expect(p.max_anios_excl).toBe(5);
    expect(p.max_dias).toBeUndefined();
  });

  test("canonical max_meses_excl valid", () => {
    const p = FiltrosPoblacionSchema.parse({ max_meses_excl: 6 });
    expect(p.max_meses_excl).toBe(6);
  });

  test("canonical has_age_filter true", () => {
    const p = FiltrosPoblacionSchema.parse({ min_anios: 18 });
    expect(hasAgeFilter(p)).toBe(true);
  });

  test("canonical has_age_filter false", () => {
    const p = FiltrosPoblacionSchema.parse({});
    expect(hasAgeFilter(p)).toBe(false);
  });

  test("canonical has_age_filter sexo only", () => {
    const p = FiltrosPoblacionSchema.parse({ sexo: "F" });
    expect(hasAgeFilter(p)).toBe(false);
  });

  test("all six fields default undefined", () => {
    const p = FiltrosPoblacionSchema.parse({});
    expect(p.min_dias).toBeUndefined();
    expect(p.min_meses).toBeUndefined();
    expect(p.min_anios).toBeUndefined();
    expect(p.max_dias).toBeUndefined();
    expect(p.max_meses_excl).toBeUndefined();
    expect(p.max_anios_excl).toBeUndefined();
  });

  test("ge zero min_dias rejected", () => {
    expect(() => FiltrosPoblacionSchema.parse({ min_dias: -1 })).toThrow(
      ZodError,
    );
  });

  test("ge zero max_anios_excl rejected", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ max_anios_excl: -5 }),
    ).toThrow(ZodError);
  });

  test("ge zero min_meses rejected", () => {
    expect(() => FiltrosPoblacionSchema.parse({ min_meses: -1 })).toThrow(
      ZodError,
    );
  });

  test("ge zero max_meses_excl rejected", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ max_meses_excl: -1 }),
    ).toThrow(ZodError);
  });

  test("ge zero max_dias rejected", () => {
    expect(() => FiltrosPoblacionSchema.parse({ max_dias: -1 })).toThrow(
      ZodError,
    );
  });

  test("same group min exclusivity two", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ min_dias: 10, min_meses: 1 }),
    ).toThrow(/mutually exclusive/);
  });

  test("same group min exclusivity all three", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({
        min_dias: 10,
        min_meses: 1,
        min_anios: 0,
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("same group min exclusivity dias anios", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ min_dias: 30, min_anios: 1 }),
    ).toThrow(/mutually exclusive/);
  });

  test("same group max exclusivity", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ max_dias: 100, max_meses_excl: 6 }),
    ).toThrow(/mutually exclusive/);
  });

  test("same group max exclusivity dias anios", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({ max_dias: 365, max_anios_excl: 1 }),
    ).toThrow(/mutually exclusive/);
  });

  test("same group max exclusivity meses anios", () => {
    expect(() =>
      FiltrosPoblacionSchema.parse({
        max_meses_excl: 6,
        max_anios_excl: 5,
      }),
    ).toThrow(/mutually exclusive/);
  });

  test("cross group allowed min_anios max_anios", () => {
    const p = FiltrosPoblacionSchema.parse({
      min_anios: 18,
      max_anios_excl: 65,
    });
    expect(p.min_anios).toBe(18);
    expect(p.max_anios_excl).toBe(65);
  });

  test("cross group allowed min_dias max_dias", () => {
    const p = FiltrosPoblacionSchema.parse({ min_dias: 30, max_dias: 365 });
    expect(p.min_dias).toBe(30);
    expect(p.max_dias).toBe(365);
  });

  test("cross group allowed min_meses max_meses", () => {
    const p = FiltrosPoblacionSchema.parse({
      min_meses: 6,
      max_meses_excl: 24,
    });
    expect(p.min_meses).toBe(6);
    expect(p.max_meses_excl).toBe(24);
  });

  test("model dump uses canonical names", () => {
    const p = FiltrosPoblacionSchema.parse({
      min_anios: 5,
      max_dias: 365,
      sexo: "M",
    });
    const dump = p as Record<string, unknown>;
    expect("min_anios" in dump).toBe(true);
    expect("max_dias" in dump).toBe(true);
    expect("edad_min_anios" in dump).toBe(false);
    expect("edad_max_dias" in dump).toBe(false);
  });

  test("exclusivity error from definicion context", () => {
    expect(() =>
      DefinicionIndicadorSchema.parse({
        tipo: "conteo_atenciones",
        poblacion: { min_dias: 10, min_meses: 1 },
      }),
    ).toThrow(/mutually exclusive/);
  });
});

describe("FiltrosPoblacionLegacy", () => {
  test("legacy edad_min_anios to min_anios", () => {
    const p = parseFiltrosPoblacion({ edad_min_anios: 10 });
    expect(p.min_anios).toBe(10);
    expect(p.min_meses).toBeUndefined();
  });

  test("legacy edad_max_anios to max_anios_excl", () => {
    const p = parseFiltrosPoblacion({ edad_max_anios: 5 });
    expect(p.max_anios_excl).toBe(5);
  });

  test("legacy edad_min_meses to min_meses", () => {
    const p = parseFiltrosPoblacion({ edad_min_meses: 6 });
    expect(p.min_meses).toBe(6);
  });

  test("legacy edad_max_meses to max_meses_excl", () => {
    const p = parseFiltrosPoblacion({ edad_max_meses: 12 });
    expect(p.max_meses_excl).toBe(12);
  });

  test("legacy edad_min_dias to min_dias", () => {
    const p = parseFiltrosPoblacion({ edad_min_dias: 1 });
    expect(p.min_dias).toBe(1);
  });

  test("legacy edad_max_dias to max_dias", () => {
    const p = parseFiltrosPoblacion({ edad_max_dias: 1825 });
    expect(p.max_dias).toBe(1825);
  });

  test("mixed legacy and canonical rejected", () => {
    expect(() =>
      parseFiltrosPoblacion({ edad_min_anios: 10, min_meses: 6 }),
    ).toThrow(/Cannot mix/);
  });

  test("mixed legacy max and canonical max rejected", () => {
    expect(() =>
      parseFiltrosPoblacion({ edad_max_dias: 100, max_anios_excl: 5 }),
    ).toThrow(/Cannot mix/);
  });

  test("legacy model uses canonical names", () => {
    const p = parseFiltrosPoblacion({
      edad_min_anios: 10,
      edad_max_dias: 365,
    });
    expect(p.min_anios).toBe(10);
    expect(p.max_dias).toBe(365);
  });

  test("legacy has_age_filter", () => {
    const p = parseFiltrosPoblacion({ edad_min_dias: 1 });
    expect(hasAgeFilter(p)).toBe(true);
  });

  test("legacy normalized through definicion", () => {
    const d = parseDefinicionIndicador({
      tipo: "conteo_atenciones",
      poblacion: { edad_max_dias: 1825 },
      evento: { location_uuids: ["uuid-x"] },
    });
    expect(d.poblacion).toBeDefined();
    expect(d.poblacion!.max_dias).toBe(1825);
    expect(hasAgeFilter(d.poblacion!)).toBe(true);
  });
});

describe("FiltrosEventoLocation", () => {
  test("location_uuids accepted", () => {
    const ev = FiltrosEventoSchema.parse({
      location_uuids: ["uuid-a", "uuid-b"],
    });
    expect(ev.location_uuids).toEqual(["uuid-a", "uuid-b"]);
  });

  test("location_uuids undefined accepted", () => {
    const ev = FiltrosEventoSchema.parse({});
    expect(ev.location_uuids).toBeUndefined();
  });

  test("location_uuids empty list accepted", () => {
    const ev = FiltrosEventoSchema.parse({ location_uuids: [] });
    expect(ev.location_uuids).toEqual([]);
  });

  test("legacy encounter_type_uuids normalized to location_uuids", () => {
    const ev = parseFiltrosEvento({
      encounter_type_uuids: ["uuid-legacy"],
    });
    expect(ev.location_uuids).toEqual(["uuid-legacy"]);
  });

  test("legacy normalization not in output", () => {
    const ev = parseFiltrosEvento({
      encounter_type_uuids: ["uuid-legacy"],
    });
    expect(ev.location_uuids).toEqual(["uuid-legacy"]);
    expect(
      "encounter_type_uuids" in (ev as Record<string, unknown>),
    ).toBe(false);
  });

  test("location_uuids with diagnosticos", () => {
    const ev = FiltrosEventoSchema.parse({
      location_uuids: ["uuid-x"],
      diagnosticos: [{ concepto_uuids: ["uuid-d"] }],
    });
    expect(ev.location_uuids).toEqual(["uuid-x"]);
    expect(ev.diagnosticos).toBeDefined();
  });

  test("location_uuids with minimo_ocurrencias", () => {
    const ev = FiltrosEventoSchema.parse({
      location_uuids: ["uuid-x"],
      minimo_ocurrencias: 3,
    });
    expect(ev.location_uuids).toEqual(["uuid-x"]);
    expect(ev.minimo_ocurrencias).toBe(3);
  });

  test("location_uuids in definicion", () => {
    const d = DefinicionIndicadorSchema.parse({
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-consulta-externa"] },
    });
    expect(d.evento).toBeDefined();
    expect(d.evento!.location_uuids).toEqual(["uuid-consulta-externa"]);
  });
});

// ── Periodo removal tests ──────────────────────────────────────────────

import {
  rejectPeriodoInPayload,
  stripPeriodoFromDefinicion,
} from "../src/types/definicion";

describe("PeriodoRemoval", () => {
  test("stripPeriodoFromDefinicion removes periodo from stored JSONB", () => {
    const stored = {
      tipo: "conteo_atenciones",
      periodo: "trimestre_actual",
      evento: { location_uuids: ["uuid-x"] },
    };
    const stripped = stripPeriodoFromDefinicion(stored) as Record<string, unknown>;
    expect("periodo" in stripped).toBe(false);
    expect(stripped["tipo"]).toBe("conteo_atenciones");
    expect(stripped["evento"]).toBeDefined();
  });

  test("stripPeriodoFromDefinicion is no-op when periodo is absent", () => {
    const stored = {
      tipo: "conteo_atenciones",
      evento: { location_uuids: ["uuid-x"] },
    };
    const stripped = stripPeriodoFromDefinicion(stored) as Record<string, unknown>;
    expect(stripped["tipo"]).toBe("conteo_atenciones");
    expect(stripped["evento"]).toBeDefined();
  });

  test("parseDefinicionIndicador strips legacy periodo on read", () => {
    const stored = {
      tipo: "conteo_atenciones",
      periodo: "anual_actual",
      evento: { location_uuids: ["uuid-x"] },
    };
    const d = parseDefinicionIndicador(stored);
    expect(d.periodo).toBeUndefined();
    expect(d.tipo).toBe("conteo_atenciones");
    expect(d.evento?.location_uuids).toEqual(["uuid-x"]);
  });

  test("rejectPeriodoInPayload throws for inbound periodo", () => {
    expect(() =>
      rejectPeriodoInPayload({
        tipo: "conteo_atenciones",
        periodo: "mes_actual",
      }),
    ).toThrow(/periodo.*ya no se acepta/);
  });

  test("rejectPeriodoInPayload passes when periodo absent", () => {
    expect(() =>
      rejectPeriodoInPayload({
        tipo: "conteo_atenciones",
      }),
    ).not.toThrow();
  });
});
