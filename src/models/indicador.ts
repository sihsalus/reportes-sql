/**
 * Sequelize ORM models for the motor-indicadores-core domain.
 *
 * Three core entities:
 * - Indicador: the indicator definition (name, description, active flag).
 * - IndicadorVersion: immutable versioned JSONB definition (append-only).
 * - IndicadorResultado: computed result for a specific version and period.
 *
 * All models use UUID primary keys. Versioning is enforced via
 * UNIQUE(indicador_id, version).
 */

import { DataTypes, Model, type InferAttributes, type InferCreationAttributes, type CreationOptional } from "sequelize";
import { sequelize } from "../database/postgres.js";

// ── Indicador ──────────────────────────────────────────────────────────

export class Indicador extends Model<
  InferAttributes<Indicador>,
  InferCreationAttributes<Indicador>
> {
  declare id: CreationOptional<string>;
  declare nombre: string;
  declare descripcion: string | null;
  declare activo: CreationOptional<boolean>;
  declare creado_en: CreationOptional<Date>;
}

Indicador.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    nombre: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
    creado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "indicador",
    timestamps: false,
  },
);

// ── IndicadorVersion ───────────────────────────────────────────────────

export class IndicadorVersion extends Model<
  InferAttributes<IndicadorVersion>,
  InferCreationAttributes<IndicadorVersion>
> {
  declare id: CreationOptional<string>;
  declare indicador_id: string;
  declare version: number;
  declare definicion: Record<string, unknown>;
  declare creado_en: CreationOptional<Date>;
}

IndicadorVersion.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    indicador_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Indicador,
        key: "id",
      },
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    definicion: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    creado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "indicador_version",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["indicador_id", "version"],
      },
    ],
  },
);

// ── IndicadorResultado ─────────────────────────────────────────────────

export class IndicadorResultado extends Model<
  InferAttributes<IndicadorResultado>,
  InferCreationAttributes<IndicadorResultado>
> {
  declare id: CreationOptional<string>;
  declare indicador_version_id: string;
  declare periodo_inicio: Date;
  declare periodo_fin: Date;
  declare valor: number;
  declare calculado_en: CreationOptional<Date>;
  declare mes_referencia: CreationOptional<Date | null>;
  declare es_canonico: CreationOptional<boolean>;
}

IndicadorResultado.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    indicador_version_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: IndicadorVersion,
        key: "id",
      },
    },
    periodo_inicio: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    periodo_fin: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    valor: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
    },
    calculado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
    mes_referencia: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    es_canonico: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "indicador_resultado",
    timestamps: false,
    indexes: [
      {
        name: "idx_resultado_version_mes_canonico",
        fields: ["indicador_version_id", "mes_referencia", "es_canonico"],
      },
      {
        name: "idx_resultado_periodo",
        fields: ["periodo_inicio", "periodo_fin"],
      },
    ],
  },
);

// ── IndicadorMeta ──────────────────────────────────────────────────────

export class IndicadorMeta extends Model<
  InferAttributes<IndicadorMeta>,
  InferCreationAttributes<IndicadorMeta>
> {
  declare id: CreationOptional<string>;
  declare indicador_version_id: string;
  declare anio: number;
  declare valor_meta: number;
  declare creado_en: CreationOptional<Date>;
}

IndicadorMeta.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    indicador_version_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: IndicadorVersion,
        key: "id",
      },
    },
    anio: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    valor_meta: {
      type: DataTypes.DECIMAL(18, 6),
      allowNull: false,
    },
    creado_en: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "indicador_meta",
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["indicador_version_id", "anio"],
      },
    ],
  },
);

// ── Associations ───────────────────────────────────────────────────────

Indicador.hasMany(IndicadorVersion, {
  sourceKey: "id",
  foreignKey: "indicador_id",
  as: "versiones",
});

IndicadorVersion.belongsTo(Indicador, {
  targetKey: "id",
  foreignKey: "indicador_id",
  as: "indicador",
});

IndicadorVersion.hasMany(IndicadorResultado, {
  sourceKey: "id",
  foreignKey: "indicador_version_id",
  as: "resultados",
});

IndicadorResultado.belongsTo(IndicadorVersion, {
  targetKey: "id",
  foreignKey: "indicador_version_id",
  as: "indicador_version",
});

IndicadorVersion.hasMany(IndicadorMeta, {
  sourceKey: "id",
  foreignKey: "indicador_version_id",
  as: "metas",
});

IndicadorMeta.belongsTo(IndicadorVersion, {
  targetKey: "id",
  foreignKey: "indicador_version_id",
  as: "indicador_version",
});
