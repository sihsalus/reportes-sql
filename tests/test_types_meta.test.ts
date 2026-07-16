/**
 * Zod schema validation tests for meta (annual target) management.
 *
 * Covers MetaUpsertSchema, MetaQuerySchema, and MetaDeleteSchema.
 */

import {
  MetaUpsertSchema,
  MetaQuerySchema,
  MetaDeleteSchema,
} from "../src/types/meta";
import { ZodError } from "zod";

const VERSION_UUID = "00000000-0000-0000-0000-000000000001";
const INDICADOR_UUID = "00000000-0000-0000-0000-000000000002";

describe("MetaUpsertSchema", () => {
  test("valid upsert body passes", () => {
    const body = MetaUpsertSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: 2026,
      valor_meta: 1500,
    });
    expect(body.indicador_version_id).toBe(VERSION_UUID);
    expect(body.anio).toBe(2026);
    expect(body.valor_meta).toBe(1500);
  });

  test("coerces string anio to number", () => {
    const body = MetaUpsertSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: "2026",
      valor_meta: 1500,
    });
    expect(body.anio).toBe(2026);
    expect(typeof body.anio).toBe("number");
  });

  test("rejects missing indicador_version_id", () => {
    expect(() =>
      MetaUpsertSchema.parse({ anio: 2026, valor_meta: 1500 }),
    ).toThrow(ZodError);
  });

  test("rejects non-UUID indicador_version_id", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: "not-a-uuid",
        anio: 2026,
        valor_meta: 1500,
      }),
    ).toThrow(ZodError);
  });

  test("rejects anio below 2000", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: 1999,
        valor_meta: 1500,
      }),
    ).toThrow(ZodError);
  });

  test("rejects anio above 2100", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: 2101,
        valor_meta: 1500,
      }),
    ).toThrow(ZodError);
  });

  test("rejects negative valor_meta", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: 2026,
        valor_meta: -1,
      }),
    ).toThrow(ZodError);
  });

  test("valor_meta zero is valid", () => {
    const body = MetaUpsertSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: 2026,
      valor_meta: 0,
    });
    expect(body.valor_meta).toBe(0);
  });

  test("rejects non-integer anio", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: 2026.5,
        valor_meta: 1500,
      }),
    ).toThrow(ZodError);
  });

  test("rejects missing anio", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        valor_meta: 1500,
      }),
    ).toThrow(ZodError);
  });

  test("rejects missing valor_meta", () => {
    expect(() =>
      MetaUpsertSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: 2026,
      }),
    ).toThrow(ZodError);
  });

  test("strips unknown fields (Zod default)", () => {
    const body = MetaUpsertSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: 2026,
      valor_meta: 1500,
      extra: "ignored",
    });
    expect(body.indicador_version_id).toBe(VERSION_UUID);
    expect(body.anio).toBe(2026);
    expect(body.valor_meta).toBe(1500);
    expect((body as Record<string, unknown>).extra).toBeUndefined();
  });
});

describe("MetaQuerySchema", () => {
  test("query by indicador_version_id + anio passes", () => {
    const q = MetaQuerySchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: "2026",
    });
    expect(q.indicador_version_id).toBe(VERSION_UUID);
    expect(q.anio).toBe(2026);
  });

  test("query by indicador_id + anio passes", () => {
    const q = MetaQuerySchema.parse({
      indicador_id: INDICADOR_UUID,
      anio: "2026",
    });
    expect(q.indicador_id).toBe(INDICADOR_UUID);
    expect(q.anio).toBe(2026);
  });

  test("rejects both indicador_version_id and indicador_id", () => {
    expect(() =>
      MetaQuerySchema.parse({
        indicador_version_id: VERSION_UUID,
        indicador_id: INDICADOR_UUID,
        anio: "2026",
      }),
    ).toThrow(ZodError);
  });

  test("rejects neither indicador_version_id nor indicador_id", () => {
    expect(() =>
      MetaQuerySchema.parse({ anio: "2026" }),
    ).toThrow(ZodError);
  });

  test("rejects missing anio", () => {
    expect(() =>
      MetaQuerySchema.parse({ indicador_version_id: VERSION_UUID }),
    ).toThrow(ZodError);
  });

  test("rejects anio below 2000", () => {
    expect(() =>
      MetaQuerySchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: "1999",
      }),
    ).toThrow(ZodError);
  });

  test("rejects anio above 2100", () => {
    expect(() =>
      MetaQuerySchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: "2101",
      }),
    ).toThrow(ZodError);
  });

  test("coerces string anio to number", () => {
    const q = MetaQuerySchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: "2026",
    });
    expect(q.anio).toBe(2026);
    expect(typeof q.anio).toBe("number");
  });

  test("rejects non-UUID indicador_version_id", () => {
    expect(() =>
      MetaQuerySchema.parse({
        indicador_version_id: "garbage",
        anio: 2026,
      }),
    ).toThrow(ZodError);
  });

  test("rejects non-UUID indicador_id", () => {
    expect(() =>
      MetaQuerySchema.parse({
        indicador_id: "garbage",
        anio: 2026,
      }),
    ).toThrow(ZodError);
  });
});

describe("MetaDeleteSchema", () => {
  test("valid delete query passes", () => {
    const q = MetaDeleteSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: "2026",
    });
    expect(q.indicador_version_id).toBe(VERSION_UUID);
    expect(q.anio).toBe(2026);
  });

  test("rejects missing indicador_version_id", () => {
    expect(() =>
      MetaDeleteSchema.parse({ anio: "2026" }),
    ).toThrow(ZodError);
  });

  test("rejects non-UUID indicador_version_id", () => {
    expect(() =>
      MetaDeleteSchema.parse({
        indicador_version_id: "not-uuid",
        anio: 2026,
      }),
    ).toThrow(ZodError);
  });

  test("rejects anio below 2000", () => {
    expect(() =>
      MetaDeleteSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: "1999",
      }),
    ).toThrow(ZodError);
  });

  test("rejects anio above 2100", () => {
    expect(() =>
      MetaDeleteSchema.parse({
        indicador_version_id: VERSION_UUID,
        anio: "2101",
      }),
    ).toThrow(ZodError);
  });

  test("rejects missing anio", () => {
    expect(() =>
      MetaDeleteSchema.parse({ indicador_version_id: VERSION_UUID }),
    ).toThrow(ZodError);
  });

  test("coerces string anio to number", () => {
    const q = MetaDeleteSchema.parse({
      indicador_version_id: VERSION_UUID,
      anio: "2026",
    });
    expect(q.anio).toBe(2026);
    expect(typeof q.anio).toBe("number");
  });
});
