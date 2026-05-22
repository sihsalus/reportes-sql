import type { ReactElement } from 'react';
import { useForm, useFieldArray, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Label from '@/components/ui/Label';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
import EncounterTypeSelector from '@/components/EncounterTypeSelector';
import DiagnosticoSelector from '@/components/DiagnosticoSelector';
import {
  indicadorFormSchema,
  type IndicadorFormValues,
} from '@/features/indicadores/schema';

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
    encounter_type_uuids: [],
    minimo_ocurrencias: 1,
    diagnosticos: undefined,
    ordenes: undefined,
  },
};

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

  // ── Determine current filtro mode from watched values ──
  const watchedDiag = watch('evento.diagnosticos');
  const watchedOrdenes = watch('evento.ordenes');

  const currentMode: FiltroMode =
    watchedDiag && watchedDiag.length > 0
      ? 'diagnosticos'
      : watchedOrdenes && watchedOrdenes.length > 0
        ? 'ordenes'
        : 'ninguno';

  // ── useFieldArray for diagnosticos ──
  const {
    fields: diagFields,
    append: appendDiag,
    remove: removeDiag,
  } = useFieldArray({
    control,
    name: 'evento.diagnosticos',
  });

  // ── useFieldArray for ordenes ──
  const {
    fields: ordFields,
    append: appendOrd,
    remove: removeOrd,
  } = useFieldArray({
    control,
    name: 'evento.ordenes',
  });

  const handleFiltroToggle = (mode: FiltroMode) => {
    if (mode === 'diagnosticos') {
      // Clear ordenes, set one empty diagnostico
      setValue('evento.ordenes', undefined);
      setValue('evento.diagnosticos', [{ concepto_uuids: [], tipo_diagnostico: undefined }]);
    } else if (mode === 'ordenes') {
      // Clear diagnosticos, set one empty orden
      setValue('evento.diagnosticos', undefined);
      setValue('evento.ordenes', [{ concepto_uuid: '' }]);
    } else {
      // Clear both
      setValue('evento.diagnosticos', undefined);
      setValue('evento.ordenes', undefined);
    }
  };

  const submitHandler = handleSubmit((data) => {
    onSubmit(data);
  });

  return (
    <form onSubmit={submitHandler} className="space-y-8">
      {/* Server error banner */}
      {serverError && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {serverError}
        </div>
      )}

      {/* Edit mode info banner */}
      {mode === 'edit' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-medium">Solo puedes editar el nombre y la descripción.</p>
          <p className="mt-1">
            Para modificar la definición de cálculo, usa{' '}
            <strong>Nueva versión</strong> desde la página del indicador.
          </p>
        </div>
      )}

      {/* Metadata (hidden in version mode) */}
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

      {/* Definition fields (hidden in edit mode) */}
      {mode !== 'edit' && (
        <>
          {/* Tipo y Periodo */}
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
                  <option value="mes_anterior">Mes anterior</option>
                  <option value="semana_actual">Semana actual</option>
                  <option value="semana_anterior">Semana anterior</option>
                </Select>
                {errors.periodo && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.periodo.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Evento (singular) — with nested diagnosticos/ordenes */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Evento</h2>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="space-y-4">
                {/* Encounter types */}
                <div>
                  <Label>Tipos de encuentro</Label>
                  <EncounterTypeSelector
                    control={control}
                    name="evento.encounter_type_uuids"
                  />
                  {errors.evento?.encounter_type_uuids && (
                    <p className="mt-1 text-sm text-red-600" role="alert">
                      {errors.evento.encounter_type_uuids.message}
                    </p>
                  )}
                </div>

                {/* Minimo ocurrencias */}
                <div>
                  <Label htmlFor="evento.minimo_ocurrencias">
                    Mínimo de ocurrencias
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

                {/* ── Filtro toggle: Ninguno / Diagnósticos / Órdenes ── */}
                <div>
                  <Label>Filtro adicional</Label>
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

                {/* ── Diagnosticos fields ── */}
                {currentMode === 'diagnosticos' && (
                  <div className="space-y-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-700">
                        Diagnósticos
                      </h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          appendDiag({ concepto_uuids: [], tipo_diagnostico: undefined })
                        }
                      >
                        Agregar diagnóstico
                      </Button>
                    </div>

                    {diagFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-600">
                            Diagnóstico #{index + 1}
                          </h4>
                          {diagFields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeDiag(index)}
                              className="text-red-600 hover:text-red-700"
                            >
                              Quitar
                            </Button>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div>
                            <Label htmlFor={`evento.diagnosticos.${index}.concepto_uuids`}>
                              Conceptos de diagnóstico
                            </Label>
                            <DiagnosticoSelector
                              control={control}
                              name={`evento.diagnosticos.${index}.concepto_uuids` as `evento.diagnosticos.${number}.concepto_uuids`}
                            />
                          </div>

                          <div>
                            <Label
                              htmlFor={`evento.diagnosticos.${index}.tipo_diagnostico`}
                            >
                              Tipo de diagnóstico
                            </Label>
                            <Select
                              id={`evento.diagnosticos.${index}.tipo_diagnostico`}
                              {...register(
                                `evento.diagnosticos.${index}.tipo_diagnostico`,
                              )}
                            >
                              <option value="">Sin filtro</option>
                              <option value="definitivo">Definitivo</option>
                              <option value="presuntivo">Presuntivo</option>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Ordenes fields ── */}
                {currentMode === 'ordenes' && (
                  <div className="space-y-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-700">
                        Órdenes
                      </h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendOrd({ concepto_uuid: '' })}
                      >
                        Agregar concepto
                      </Button>
                    </div>

                    {ordFields.length === 0 && (
                      <p className="text-sm text-gray-500">
                        Sin filtros de orden — todos los encuentros cuentan.
                      </p>
                    )}

                    {ordFields.map((field, index) => (
                      <div
                        key={field.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-600">
                            Concepto #{index + 1}
                          </h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOrd(index)}
                            className="text-red-600 hover:text-red-700"
                          >
                            Quitar concepto
                          </Button>
                        </div>

                        <div>
                          <Label
                            htmlFor={`evento.ordenes.${index}.concepto_uuid`}
                          >
                            Concepto
                          </Label>
                          <Input
                            id={`evento.ordenes.${index}.concepto_uuid`}
                            type="text"
                            placeholder="UUID o identificador del concepto"
                            {...register(
                              `evento.ordenes.${index}.concepto_uuid`,
                            )}
                            aria-invalid={
                              errors.evento?.ordenes?.[index]?.concepto_uuid
                                ? 'true'
                                : 'false'
                            }
                          />
                          {errors.evento?.ordenes?.[index]?.concepto_uuid && (
                            <p className="mt-1 text-sm text-red-600" role="alert">
                              {
                                errors.evento.ordenes[index]?.concepto_uuid
                                  ?.message
                              }
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Población */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Filtros de población (opcional)
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="poblacion.edad_min_anios">Edad mínima (años)</Label>
                <Input
                  id="poblacion.edad_min_anios"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_min_anios', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_min_anios && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_min_anios.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="poblacion.edad_max_anios">Edad máxima (años)</Label>
                <Input
                  id="poblacion.edad_max_anios"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_max_anios', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_max_anios && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_max_anios.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="poblacion.sexo">Sexo</Label>
                <Select id="poblacion.sexo" {...register('poblacion.sexo')}>
                  <option value="">Cualquiera</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="poblacion.edad_min_meses">Edad mínima (meses)</Label>
                <Input
                  id="poblacion.edad_min_meses"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_min_meses', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_min_meses && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_min_meses.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="poblacion.edad_max_meses">Edad máxima (meses)</Label>
                <Input
                  id="poblacion.edad_max_meses"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_max_meses', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_max_meses && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_max_meses.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="poblacion.edad_min_dias">Edad mínima (días)</Label>
                <Input
                  id="poblacion.edad_min_dias"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_min_dias', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_min_dias && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_min_dias.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="poblacion.edad_max_dias">Edad máxima (días)</Label>
                <Input
                  id="poblacion.edad_max_dias"
                  type="number"
                  min={0}
                  {...register('poblacion.edad_max_dias', {
                    valueAsNumber: true,
                  })}
                />
                {errors.poblacion?.edad_max_dias && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {errors.poblacion.edad_max_dias.message}
                  </p>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Actions */}
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
