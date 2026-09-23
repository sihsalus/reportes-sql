import { jest } from "@jest/globals";

const mockIndicadorFindOne = jest.fn();
const mockIndicadorCreate = jest.fn();
const mockVersionFindOne = jest.fn();
const mockVersionCreate = jest.fn();

jest.mock("../src/models/indicador.js", () => ({
  Indicador: {
    findOne: (...args: unknown[]) => mockIndicadorFindOne(...args),
    create: (...args: unknown[]) => mockIndicadorCreate(...args),
  },
  IndicadorVersion: {
    findOne: (...args: unknown[]) => mockVersionFindOne(...args),
    create: (...args: unknown[]) => mockVersionCreate(...args),
  },
  IndicadorResultado: {},
}));

class MockOpenMRSUnavailableError extends Error {
  constructor() {
    super("OpenMRS no disponible");
    this.name = "OpenMRSUnavailableError";
  }
}

const mockValidarLocations = jest.fn();
const mockValidarEncounterTypes = jest.fn();
const mockValidarDiagnosticos = jest.fn();

jest.mock("../src/validators/openmrs.js", () => ({
  validarDefinicionLocationUuids: (...args: unknown[]) =>
    mockValidarLocations(...args),
  validarDefinicionEncounterTypeUuids: (...args: unknown[]) =>
    mockValidarEncounterTypes(...args),
  validarDefinicionDiagnosticoUuids: (...args: unknown[]) =>
    mockValidarDiagnosticos(...args),
  OpenMRSUnavailableError: MockOpenMRSUnavailableError,
}));

import {
  INDICATOR_CATALOG,
  ensureCatalogIndicator,
  registerIndicatorCatalog,
} from "../src/catalog/indicators.js";
import { parseDefinicionIndicador } from "../src/types/definicion.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockValidarLocations.mockResolvedValue([]);
  mockValidarEncounterTypes.mockResolvedValue([]);
  mockValidarDiagnosticos.mockResolvedValue([]);
});

describe("registerIndicatorCatalog", () => {
  test("registers every missing entry with its full definition and version 1", async () => {
    mockIndicadorFindOne.mockResolvedValue(null);
    mockIndicadorCreate.mockImplementation(async (values: unknown) => ({
      id: `id-${(values as { nombre: string }).nombre}`,
    }));
    mockVersionFindOne.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({ id: "version-1" });

    const results = await registerIndicatorCatalog([
      {
        nombre: "ind-a",
        descripcion: "A",
        definicion: {
          tipo: "conteo_atenciones",
          poblacion: { max_anios_excl: 5 },
          evento: { location_uuids: ["12345678-1234-1234-1234-123456789abc"] },
        },
      },
      {
        nombre: "ind-b",
        descripcion: null,
        definicion: { tipo: "conteo_pacientes" },
        activo: false,
      },
    ]);

    expect(results).toHaveLength(2);
    expect(mockIndicadorCreate).toHaveBeenCalledTimes(2);
    expect(mockVersionCreate).toHaveBeenCalledTimes(2);
    expect(mockIndicadorCreate).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: "ind-b", activo: false }),
    );
    // La definicion registrada es la completa, lista para calcular.
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        definicion: expect.objectContaining({
          tipo: "conteo_atenciones",
          poblacion: { max_anios_excl: 5 },
        }),
      }),
    );
    expect(results[0]).toEqual(
      expect.objectContaining({
        nombre: "ind-a",
        indicatorCreated: true,
        versionCreated: true,
      }),
    );
  });

  test("never modifies an existing indicator, only fills the missing version", async () => {
    mockIndicadorFindOne.mockResolvedValue({ id: "ind-1" });
    mockVersionFindOne.mockResolvedValue({ id: "version-1" });

    const results = await registerIndicatorCatalog([
      {
        nombre: "ind-existente",
        descripcion: "cambiada a proposito",
        definicion: { tipo: "conteo_pacientes" },
      },
    ]);

    expect(mockIndicadorCreate).not.toHaveBeenCalled();
    expect(mockVersionCreate).not.toHaveBeenCalled();
    // Nada que escribir → OpenMRS ni se consulta.
    expect(mockValidarLocations).not.toHaveBeenCalled();
    expect(mockValidarEncounterTypes).not.toHaveBeenCalled();
    expect(mockValidarDiagnosticos).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        nombre: "ind-existente",
        indicatorCreated: false,
        versionCreated: false,
        indicadorId: "ind-1",
      },
    ]);
  });

  test("aborts without registering on UUIDs unknown to OpenMRS", async () => {
    mockIndicadorFindOne.mockResolvedValue(null);
    mockValidarDiagnosticos.mockResolvedValueOnce(["uuid-malo"]);

    await expect(
      registerIndicatorCatalog([
        {
          nombre: "ind-malo",
          descripcion: null,
          definicion: { tipo: "conteo_atenciones" },
        },
      ]),
    ).rejects.toThrow(
      /Catálogo: no se pudo registrar "ind-malo": UUIDs desconocidos en OpenMRS \[diagnosticos\]: uuid-malo/,
    );
    expect(mockIndicadorCreate).not.toHaveBeenCalled();
    expect(mockVersionCreate).not.toHaveBeenCalled();
  });

  test("aborts without registering when OpenMRS is unavailable", async () => {
    mockIndicadorFindOne.mockResolvedValue(null);
    mockValidarLocations.mockRejectedValueOnce(
      new MockOpenMRSUnavailableError(),
    );

    await expect(
      registerIndicatorCatalog([
        {
          nombre: "ind-x",
          descripcion: null,
          definicion: { tipo: "conteo_atenciones" },
        },
      ]),
    ).rejects.toThrow(/OpenMRS no disponible/);
    expect(mockIndicadorCreate).not.toHaveBeenCalled();
    expect(mockVersionCreate).not.toHaveBeenCalled();
  });

  test("fails fast on an invalid catalog definition", async () => {
    await expect(
      registerIndicatorCatalog([
        {
          nombre: "ind-roto",
          descripcion: null,
          definicion: { tipo: "tipo_inexistente" },
        },
      ]),
    ).rejects.toThrow();
    expect(mockIndicadorCreate).not.toHaveBeenCalled();
  });

  test("catalog includes the legacy default indicator", () => {
    const nombres = INDICATOR_CATALOG.map((e) => e.nombre);
    expect(nombres).toContain("seed/default-indicator");
  });

  test("catalog includes IRA with a complete definition", () => {
    const entry = INDICATOR_CATALOG.find((e) =>
      e.nombre.includes("Infección respiratoria aguda"),
    );
    expect(entry).toBeDefined();
    const def = entry!.definicion as {
      tipo: string;
      poblacion: { max_anios_excl: number };
      evento: {
        location_uuids: string[];
        diagnosticos: Array<{
          concepto_uuids: string[];
          tipo_diagnostico: string;
        }>;
      };
    };
    expect(def.tipo).toBe("conteo_atenciones");
    expect(def.poblacion.max_anios_excl).toBe(5);
    expect(def.evento.location_uuids).toEqual([
      "35d2234e-129a-4c40-abb2-1ae0b2400001",
    ]);
    // Los 8 CIE-10 de la ficha 3331101, diagnostico definitivo (OR entre ellos).
    expect(def.evento.diagnosticos).toHaveLength(1);
    expect(def.evento.diagnosticos[0]!.concepto_uuids).toHaveLength(8);
    expect(def.evento.diagnosticos[0]!.tipo_diagnostico).toBe("definitivo");
    // La definicion tal cual queda registrada debe ser valida para calcular.
    expect(() => parseDefinicionIndicador(entry!.definicion)).not.toThrow();
  });

  test("ensureCatalogIndicator activates by default", async () => {
    mockIndicadorFindOne.mockResolvedValue(null);
    mockIndicadorCreate.mockResolvedValue({ id: "ind-1" });
    mockVersionFindOne.mockResolvedValue({ id: "v-1" });

    await ensureCatalogIndicator({
      nombre: "ind-x",
      descripcion: null,
      definicion: { tipo: "conteo_atenciones" },
    });

    expect(mockIndicadorCreate).toHaveBeenCalledWith(
      expect.objectContaining({ activo: true }),
    );
  });
});
