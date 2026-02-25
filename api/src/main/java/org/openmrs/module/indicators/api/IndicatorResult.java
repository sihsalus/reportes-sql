/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed under the terms of the
 * Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed
 * with this file, You can obtain one at http://mozilla.org/MPL/2.0/. OpenMRS
 * is also distributed under the terms of the Healthcare Disclaimer located at
 * http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators.api;

/*
 * CONCEPTO: DTO (Data Transfer Object)
 * ──────────────────────────────────────
 * Un DTO es un objeto simple que transporta datos entre capas de la aplicación.
 * No tiene lógica de negocio, solo campos + getters/setters.
 *
 * ¿Por qué no retornar directamente el EvaluatedIndicator del Reporting Module?
 * Porque eso crearía un acoplamiento fuerte entre tu API pública y el Reporting Module.
 * Si en el futuro cambias el motor de evaluación, solo cambias IndicatorsServiceImpl,
 * no toda la interfaz pública del servicio.
 *
 * Este es el principio de "separar el modelo propio del reporting" que pediste.
 */

import java.util.Date;

/**
 * Resultado de la evaluación de un indicador.
 * <p>
 * Este objeto desacopla tu API del Reporting Module: los consumidores de tu servicio
 * (controladores, otros módulos, tests) trabajan con este DTO, no con clases del Reporting Module.
 */
public class IndicatorResult {
	
	/** ID del IndicatorDefinition evaluado. */
	private final Integer indicatorDefinitionId;
	
	/** Nombre del indicador. */
	private final String indicatorName;
	
	/** Número de pacientes que cumplen las condiciones del indicador. */
	private final long count;
	
	/** Inicio del período que se evaluó. */
	private final Date startDate;
	
	/** Fin del período que se evaluó. */
	private final Date endDate;
	
	public IndicatorResult(Integer indicatorDefinitionId, String indicatorName, long count, Date startDate, Date endDate) {
		this.indicatorDefinitionId = indicatorDefinitionId;
		this.indicatorName = indicatorName;
		this.count = count;
		this.startDate = startDate;
		this.endDate = endDate;
	}
	
	public Integer getIndicatorDefinitionId() {
		return indicatorDefinitionId;
	}
	
	public String getIndicatorName() {
		return indicatorName;
	}
	
	public long getCount() {
		return count;
	}
	
	public Date getStartDate() {
		return startDate;
	}
	
	public Date getEndDate() {
		return endDate;
	}
	
	@Override
	public String toString() {
		return "IndicatorResult{" + "indicatorDefinitionId=" + indicatorDefinitionId + ", indicatorName='" + indicatorName
		        + '\'' + ", count=" + count + ", startDate=" + startDate + ", endDate=" + endDate + '}';
	}
}
