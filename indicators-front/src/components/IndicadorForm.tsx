import { useState, useEffect, type ReactElement } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Label from '@/components/ui/Label';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import LocationSelector from '@/components/LocationSelector';
import DiagnosticoSelector from '@/components/DiagnosticoSelector';
import OrdenSelector from '@/components/OrdenSelector';
import AgeInputRow from '@/components/AgeInputRow';
import {
  indicadorFormSchema,
  type IndicadorFormValues,
} from '@/features/indicadores/schema';
import type { PoblacionForm } from '@/api/types';

export interface IndicadorFormProps {
  mode: 'create' | 'edit' | 'version';
  defaultValues?: Partial<IndicadorFormValues>;
  onSubmit: (values: IndicadorFormValues) => void;
  serverError?: string | null;
  isPending?: boolean;
}

type FiltroMode = 'ninguno' | 'diagnosticos' | 'ordenes';

const DEFAULT_VALUES: IndicadorFormValues = {
  nombre: '',
  descripcion: null,
  tipo: 'conteo_atenciones',
  periodo: 'mes_actual',
  evento: {
    location_uuids: [],
    minimo_ocurrencias: 1,
    diagnosticos: undefined,
    ordenes: undefined,
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function extractAgeFormState(poblacion?: PoblacionForm) {
  let minAnios = '', minMeses = '', minDias = '';
  let maxAnios = '', maxMeses = '', maxDias = '';

  if (!poblacion) return { minAnios, minMeses, minDias, maxAnios, maxMeses, maxDias };

  if (poblacion.min_dias !== undefined) {
    minDias = String(poblacion.min_dias);
  } else if (poblacion.min_meses !== undefined) {
    minAnios = String(Math.floor(poblacion.min_meses / 12));
    minMeses = String(poblacion.min_meses % 12);
  } else if (poblacion.min_anios !== undefined) {
    minAnios = String(poblacion.min_anios);
  }

  if (poblacion.max_dias !== undefined) {
    maxDias = String(poblacion.max_dias);
  } else if (poblacion.max_meses_excl !== undefined) {
    maxAnios = String(Math.floor(poblacion.max_meses_excl / 12));
    maxMeses = String(poblacion.max_meses_excl % 12);
  } else if (poblacion.max_anios_excl !== undefined) {
    maxAnios = String(poblacion.max_anios_excl);
  }

  return { minAnios, minMeses, minDias, maxAnios, maxMeses, maxDias };
}

function parseNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildPoblacion(
  minAnios: string,
  minMeses: string,
  minDias: string,
  maxAnios: string,
  maxMeses: string,
  maxDias: string,
  sexo?: 'M' | 'F',
): PoblacionForm | undefined {
  const result: Record<string, number | string | undefined> = {};

  const totalMesesMin = parseNum(minAnios) * 12 + parseNum(minMeses);
  const minD = parseNum(minDias);

  if (totalMesesMin === 0) {
    if (minD > 0) result.min_dias = minD;
  } else {
    result.min_meses = totalMesesMin;
  }

  const totalMesesMax = parseNum(maxAnios) * 12 + parseNum(maxMeses);
  const maxD = parseNum(maxDias);

  if (totalMesesMax === 0) {
    if (maxD > 0) result.max_dias = maxD;
  } else {
    result.max_meses_excl = maxD > 0 ? totalMesesMax + 1 : totalMesesMax;
  }

  if (sexo) result.sexo = sexo;

  const keys = Object.keys(result);
  if (keys.length === 0 || (keys.length === 1 && keys[0] === 'sexo')) return undefined;

  return result as unknown as PoblacionForm;
}

// ── Component ─────────────────────────────────────────────────────────

export default function IndicadorForm({
  mode,
  defaultValues,
  onSubmit,
  serverError,
  isPending = false,
}: IndicadorFormProps): ReactElement {
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
    setValue,
  } = useForm<IndicadorFormValues>({
    resolver: zodResolver(indicadorFormSchema) as Resolver<IndicadorFormValues>,
    defaultValues: defaultValues ?? DEFAULT_VALUES,
  });

  // ── Age UI state (3 inputs per bound, transformed on submit) ──
  const init = extractAgeFormState(defaultValues?.poblacion);
  const [minAnios, setMinAnios] = useState(init.minAnios);
  const [minMeses, setMinMeses] = useState(init.minMeses);
  const [minDias, setMinDias] = useState(init.minDias);
  const [maxAnios, setMaxAnios] = useState(init.maxAnios);
  const [maxMeses, setMaxMeses] = useState(init.maxMeses);
  const [maxDias, setMaxDias] = useState(init.maxDias);

  useEffect(() => {
    const s = extractAgeFormState(defaultValues?.poblacion);
    setMinAnios(s.minAnios);
    setMinMeses(s.minMeses);
    setMinDias(s.minDias);
    setMaxAnios(s.maxAnios);
    setMaxMeses(s.maxMeses);
    setMaxDias(s.maxDias);
  }, [defaultValues?.poblacion]);

  // ── Determine current filtro mode from watched values ──
  const watchedDiag = watch('evento.diagnosticos');
  const watchedOrdenes = watch('evento.ordenes');

  const currentMode: FiltroMode =
    watchedDiag && watchedDiag.length > 0
      ? 'diagnosticos'
      : watchedOrdenes && watchedOrdenes.length > 0
        ? 'ordenes'
        : 'ninguno';

  const handleFiltroToggle = (mode: FiltroMode) => {
    if (mode === 'diagnosticos') {
      setValue('evento.ordenes', undefined);
      setValue('evento.diagnosticos', [{ concepto_uuids: [], tipo_diagnostico: undefined }]);
    } else if (mode === 'ordenes') {
      setValue('evento.diagnosticos', undefined);
      setValue('evento.ordenes', [{ concepto_uuids: [] }]);
    } else {
      setValue('evento.diagnosticos', undefined);
      setValue('evento.ordenes', undefined);
    }
  };

  const submitHandler = handleSubmit((data) => {
    const sexo = data.poblacion?.sexo as 'M' | 'F' | undefined;
    const canonicalPoblacion = buildPoblacion(
      minAnios, minMeses, minDias,
      maxAnios, maxMeses, maxDias,
      sexo,
    );
    onSubmit({ ...data, poblacion: canonicalPoblacion });
  });

  return (
    <form onSubmit={submitHandler} className="space-y-8">
      {serverError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {serverError}
        </div>
      )}

      {mode === 'edit' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-medium">Solo puedes editar el nombre y la descripción.</p>
          <p className="mt-1">
            Para modificar la definición de cálculo, usa{' '}
            <strong>Nueva versión</strong> desde la página del indicador.
          </p>
        </div>
      )}

      {mode !== 'version' && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Información general
          </h2>

          <div>
            <Label htmlFor="nombre">Nombre</Label>
            <Input
              id="nombre"
              {...register('nombre')}
              placeholder="Nombre del indicador"
              aria-invalid={errors.nombre ? 'true' : 'false'}
            />
            {errors.nombre && (
              <p className="mt-1 text-sm text-red-600" role="alert">
                {errors.nombre.message}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              {...register('descripcion')}
              placeholder="Descripción opcional"
              rows={3}
            />
          </div>
        </section>
      )}

      {mode !== 'edit' && (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Tipo y período
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tipo">Tipo de indicador</Label>
                <Select id="tipo" {...register('tipo')}>
                  <option value="conteo_atenciones">Conteo de atenciones</option>
                  <option value="conteo_pacientes">Conteo de pacientes</option>
                </Select>
                {errors.tipo && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.tipo.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="periodo">Período</Label>
                <Select id="periodo" {...register('periodo')}>
                  <option value="mes_actual">Mes actual</option>
                  <option value="trimestre_actual">Este trimestre</option>
                  <option value="semestre_actual">Este semestre</option>
                  <option value="anual_actual">Este año</option>
                </Select>
                {errors.periodo && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.periodo.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Atención</h2>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="space-y-4">
                <div>
                  <Label>Servicio</Label>
                  <LocationSelector
                    control={control}
                    name="evento.location_uuids"
                  />
                  {errors.evento?.location_uuids && (
                    <p className="mt-1 text-sm text-red-600" role="alert">
                      {errors.evento.location_uuids.message}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Filtro clínico</Label>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant={currentMode === 'ninguno' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFiltroToggle('ninguno')}
                    >
                      Ninguno
                    </Button>
                    <Button
                      type="button"
                      variant={currentMode === 'diagnosticos' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFiltroToggle('diagnosticos')}
                    >
                      Diagnósticos
                    </Button>
                    <Button
                      type="button"
                      variant={currentMode === 'ordenes' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleFiltroToggle('ordenes')}
                    >
                      Órdenes
                    </Button>
                  </div>
                  {errors.evento?.message && (
                    <p className="mt-1 text-sm text-red-600" role="alert">
                      {errors.evento.message}
                    </p>
                  )}
                </div>

                {currentMode === 'diagnosticos' && (
                  <div className="space-y-4 border-t border-gray-100 pt-4">
                    <h3 className="text-sm font-medium text-gray-700">
                      Diagnósticos
                    </h3>

                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="evento.diagnosticos.0.concepto_uuids">
                          Conceptos de diagnóstico
                        </Label>
                        <DiagnosticoSelector
                          control={control}
                          name={'evento.diagnosticos.0.concepto_uuids' as `evento.diagnosticos.${number}.concepto_uuids`}
                        />
                      </div>

                      <div>
                        <Label htmlFor="evento.diagnosticos.0.tipo_diagnostico">
                          Tipo de diagnóstico
                        </Label>
                        <Select
                          id="evento.diagnosticos.0.tipo_diagnostico"
                          {...register('evento.diagnosticos.0.tipo_diagnostico')}
                        >
                          <option value="">Sin filtro</option>
                          <option value="definitivo">Confirmado</option>
                          <option value="presuntivo">Provisional</option>
                        </Select>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                      <Label htmlFor="evento.minimo_ocurrencias">
                        Mínimo de atenciones
                      </Label>
                      <Input
                        id="evento.minimo_ocurrencias"
                        type="number"
                        min={1}
                        {...register('evento.minimo_ocurrencias', {
                          valueAsNumber: true,
                        })}
                      />
                      {errors.evento?.minimo_ocurrencias && (
                        <p className="mt-1 text-sm text-red-600" role="alert">
                          {errors.evento.minimo_ocurrencias.message}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {currentMode === 'ordenes' && (
                  <div className="space-y-4 border-t border-gray-100 pt-4">
                    <h3 className="text-sm font-medium text-gray-700">
                      Órdenes / Pruebas
                    </h3>

                    <div>
                      <Label>Conceptos de orden</Label>
                      <OrdenSelector
                        control={control}
                        name={'evento.ordenes.0.concepto_uuids' as `evento.ordenes.${number}.concepto_uuids`}
                      />
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                      <Label htmlFor="evento.minimo_ocurrencias">
                        Mínimo de atenciones
                      </Label>
                      <Input
                        id="evento.minimo_ocurrencias"
                        type="number"
                        min={1}
                        {...register('evento.minimo_ocurrencias', {
                          valueAsNumber: true,
                        })}
                      />
                      {errors.evento?.minimo_ocurrencias && (
                        <p className="mt-1 text-sm text-red-600" role="alert">
                          {errors.evento.minimo_ocurrencias.message}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Filtros de población (opcional)
            </h2>

            {(() => {
              const pob = errors.poblacion as Record<string, {message?: string} | undefined> | undefined;
              if (!pob) return null;
              if (typeof (pob as Record<string, unknown>).message === 'string') {
                return <p className="text-sm text-red-600" role="alert">{(pob as Record<string, string>).message}</p>;
              }
              if (pob.root && typeof (pob.root as Record<string, unknown>).message === 'string') {
                return <p className="text-sm text-red-600" role="alert">{(pob.root as Record<string, string>).message}</p>;
              }
              if (pob.poblacion?.message) {
                return <p className="text-sm text-red-600" role="alert">{pob.poblacion.message}</p>;
              }
              return null;
            })()}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <AgeInputRow
                label="Edad mínima"
                anios={minAnios}
                meses={minMeses}
                dias={minDias}
                onAniosChange={setMinAnios}
                onMesesChange={setMinMeses}
                onDiasChange={setMinDias}
                error={errors.poblacion?.message ?? errors.poblacion?.root?.message}
              />

              <AgeInputRow
                label="Edad máxima"
                anios={maxAnios}
                meses={maxMeses}
                dias={maxDias}
                onAniosChange={setMaxAnios}
                onMesesChange={setMaxMeses}
                onDiasChange={setMaxDias}
                error={errors.poblacion?.message ?? errors.poblacion?.root?.message}
              />

              <div>
                <Label htmlFor="poblacion.sexo">Sexo</Label>
                <Select id="poblacion.sexo" {...register('poblacion.sexo')}>
                  <option value="">Cualquiera</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                </Select>
              </div>
            </div>
          </section>
        </>
      )}

      <div className="flex items-center gap-3 pt-4">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? 'Guardando…'
            : mode === 'create'
              ? 'Crear indicador'
              : mode === 'version'
                ? 'Crear versión'
                : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
