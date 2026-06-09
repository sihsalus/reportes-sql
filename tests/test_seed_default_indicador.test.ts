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

import {
  DEFAULT_DEFINICION,
  SEEDED_INDICADOR_NOMBRE,
  seedDefaultIndicador,
} from "../src/seed/default-indicador.js";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("seedDefaultIndicador", () => {
  test("creates indicador and initial version when missing", async () => {
    const indicador = { id: "indicador-1" };
    mockIndicadorFindOne.mockResolvedValue(null);
    mockIndicadorCreate.mockResolvedValue(indicador);
    mockVersionFindOne.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({ id: "version-1" });

    const result = await seedDefaultIndicador();

    expect(mockIndicadorFindOne).toHaveBeenCalledWith({
      where: { nombre: SEEDED_INDICADOR_NOMBRE },
    });
    expect(mockIndicadorCreate).toHaveBeenCalledTimes(1);
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        indicador_id: "indicador-1",
        version: 1,
        definicion: expect.objectContaining({ tipo: "conteo_atenciones" }),
      }),
    );
    expect(result).toEqual({
      indicatorCreated: true,
      versionCreated: true,
      indicadorId: "indicador-1",
    });
  });

  test("does not duplicate indicador or version when both already exist", async () => {
    const indicador = { id: "indicador-1" };
    mockIndicadorFindOne.mockResolvedValue(indicador);
    mockVersionFindOne.mockResolvedValue({ id: "version-1" });

    const result = await seedDefaultIndicador();

    expect(mockIndicadorCreate).not.toHaveBeenCalled();
    expect(mockVersionCreate).not.toHaveBeenCalled();
    expect(result).toEqual({
      indicatorCreated: false,
      versionCreated: false,
      indicadorId: "indicador-1",
    });
  });

  test("creates version 1 if indicador exists without seeded version", async () => {
    const indicador = { id: "indicador-1" };
    mockIndicadorFindOne.mockResolvedValue(indicador);
    mockVersionFindOne.mockResolvedValue(null);
    mockVersionCreate.mockResolvedValue({ id: "version-1" });

    const result = await seedDefaultIndicador();

    expect(mockIndicadorCreate).not.toHaveBeenCalled();
    expect(mockVersionCreate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      indicatorCreated: false,
      versionCreated: true,
      indicadorId: "indicador-1",
    });
  });
});
