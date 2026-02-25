/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators.api;

import java.util.Date;

import org.openmrs.module.reporting.cohort.definition.SqlCohortDefinition;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;

/**
 * Factory/Builder que encapsula la construcción de una {@link SqlCohortDefinition} para filtrar
 * pacientes según la frecuencia mínima de observaciones de un concepto específico.
 * <p>
 * VENTAJA: El SQL queda encapsulado aquí, nunca visible en {@link IndicatorTranslator}.
 * {@link IndicatorTranslator} solo ve esta clase, no ve SQL raw.
 * <p>
 * CÓMO FUNCIONA:
 * 
 * <pre>
 * 1. IndicatorTranslator instancia ObsFrequencyCohortDefinition(conceptUuid, minFreq)
 * 2. ObsFrequencyCohortDefinition.build() genera SqlCohortDefinition internamente (con SQL encapsulado)
 * 3. El Reporting Module evalúa SqlCohortDefinition normalmente
 * </pre>
 * <p>
 * El SQL está completamente oculto en el método {@link #build()}.
 */
public class ObsFrequencyCohortDefinition {
	
	/**
	 * UUID del concepto OpenMRS que se va a buscar.
	 */
	private String conceptUuid;
	
	/**
	 * Número mínimo de veces que el concepto debe aparecer en el rango de fechas del
	 * EvaluationContext.
	 */
	private Integer minFrequency;
	
	// ─────────────────────────────────────────────────────────────────────────
	
	/**
	 * Crea una instancia con concepto y frecuencia mínima.
	 * 
	 * @param conceptUuid UUID del concepto a buscar
	 * @param minFrequency número mínimo de observaciones requeridas (>= 1)
	 */
	public ObsFrequencyCohortDefinition(String conceptUuid, Integer minFrequency) {
		this.conceptUuid = conceptUuid;
		this.minFrequency = minFrequency != null ? minFrequency : 1;
	}
	
	/**
	 * Construye la {@link SqlCohortDefinition} correspondiente, configurada con todos los
	 * parámetros necesarios.
	 * <p>
	 * El SQL está encapsulado aquí: nunca se vé en el código del traductor.
	 * 
	 * @return SqlCohortDefinition lista para ser usada en CompositionCohortDefinition
	 */
	public SqlCohortDefinition build() {
		
		/*
		 * SQL ENCAPSULADO: El SQL nunca sale de esta clase.
		 *
		 * Explicación:
		 *   - SELECT DISTINCT o.person_id → IDs únicos de pacientes
		 *   - FROM obs o → tabla de observaciones clínicas
		 *   - JOIN concept c ON c.concept_id = o.concept_id → obtener UUID del concepto
		 *   - WHERE c.uuid = :conceptUuid → filtrar por el concepto específico
		 *   - AND o.voided = 0 → solo registros activos
		 *   - AND o.obs_datetime BETWEEN :startDate AND :endDate → dentro del rango
		 *   - GROUP BY o.person_id → agrupar por paciente
		 *   - HAVING COUNT(*) >= :minFrequency → solo pacientes con >= N observaciones
		 *
		 * Ventaja: La BD ejecuta esto eficientemente, no iteramos en Java.
		 */
		String sql = "SELECT DISTINCT o.person_id " + "FROM obs o " + "JOIN concept c ON c.concept_id = o.concept_id "
		        + "WHERE c.uuid = :conceptUuid " + "AND o.voided = 0 "
		        + "AND o.obs_datetime BETWEEN :startDate AND :endDate " + "GROUP BY o.person_id "
		        + "HAVING COUNT(*) >= :minFrequency";
		
		SqlCohortDefinition sqlDef = new SqlCohortDefinition(sql);
		sqlDef.setName("Concepto " + conceptUuid + " >= " + minFrequency + " veces");
		
		// Declarar los parámetros que usa el SQL
		sqlDef.addParameter(new Parameter("startDate", "Start Date", Date.class));
		sqlDef.addParameter(new Parameter("endDate", "End Date", Date.class));
		sqlDef.addParameter(new Parameter("conceptUuid", "Concept UUID", String.class));
		sqlDef.addParameter(new Parameter("minFrequency", "Min Frequency", Integer.class));
		
		return sqlDef;
	}
	
	// ─────────────────────────────────────────────────────────────────────────
	
	/**
	 * @return el UUID del concepto
	 */
	public String getConceptUuid() {
		return conceptUuid;
	}
	
	/**
	 * @return número mínimo de observaciones
	 */
	public Integer getMinFrequency() {
		return minFrequency;
	}
	
	@Override
	public String toString() {
		return "ObsFrequencyCohortDefinition [conceptUuid=" + conceptUuid + ", minFrequency=" + minFrequency + "]";
	}
	
}
