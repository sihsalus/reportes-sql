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

/*
 * CONCEPTO: ¿Qué es el Reporting Module y por qué usarlo?
 * ─────────────────────────────────────────────────────────
 * El Reporting Module es un omod de OpenMRS que provee:
 *
 *  1. Un modelo declarativo de "definiciones":
 *     - CohortDefinition: define QUÉ pacientes incluir (sin ejecutar nada aún)
 *     - Indicator: define QUÉ contar sobre ese cohort
 *     - DataSet: colección de indicadores para un reporte completo
 *
 *  2. Un motor de evaluación:
 *     - EvaluationService: evalúa cualquier definición contra la BD real
 *     - Usa SQL optimizado, no iteración en memoria
 *
 * CONCEPTO: Definición vs Evaluación (el patrón central)
 * ────────────────────────────────────────────────────────
 * La arquitectura del Reporting Module separa completamente:
 *
	 *   DEFINICIÓN → "Pacientes entre 5 y 15 años con concepto {uuid} >= 2 veces"
 *   (objeto Java, no toca la BD)
 *
 *   EVALUACIÓN → ejecuta esa definición contra la BD con un contexto específico
 *   (genera SQL eficiente, retorna resultados reales)
 *
 * Este IndicatorTranslator solo trabaja con DEFINICIONES.
 * La EVALUACIÓN ocurre en IndicatorsServiceImpl.
 */

import java.util.ArrayList;
import java.util.List;

import org.openmrs.module.indicators.IndicatorDefinition;
import org.openmrs.module.reporting.cohort.definition.AgeCohortDefinition;
import org.openmrs.module.reporting.cohort.definition.CohortDefinition;
import org.openmrs.module.reporting.cohort.definition.CompositionCohortDefinition;
import org.openmrs.module.reporting.cohort.definition.SqlCohortDefinition;
import org.openmrs.module.reporting.evaluation.parameter.Mapped;
import org.openmrs.module.reporting.evaluation.parameter.Parameter;
import org.openmrs.module.reporting.indicator.CohortIndicator;
import org.springframework.stereotype.Component;

/**
 * Traduce un {@link IndicatorDefinition} (modelo propio) en un {@link CohortIndicator} (objeto del
 * Reporting Module) listo para ser evaluado.
 * <p>
 * Esta clase es el "puente" entre tu modelo simplificado y la potencia del Reporting Module.
 * Siguiendo el principio de responsabilidad única (SRP), este componente solo traduce, nunca evalúa
 * ni persiste.
 * <p>
 * Diagrama del flujo de traducción:
 * 
 * <pre>
 *   IndicatorDefinition
 *         │
 *         ├─ minAge/maxAge ──────────→ AgeCohortDefinition
 *         │
	 *         ├─ conceptUuids[0]/freqs[0] ─→ SqlCohortDefinition (concepto 0)
	 *         ├─ conceptUuids[1]/freqs[1] ─→ SqlCohortDefinition (concepto 1)
 *         │   ...
 *         │
 *         └─ (todos los anteriores) ─→ CompositionCohortDefinition (AND)
 *                                              │
 *                                              └─→ CohortIndicator
 * </pre>
 */
@Component("indicators.IndicatorTranslator")
public class IndicatorTranslator {
	
	/**
	 * Traduce una {@link IndicatorDefinition} completa en un {@link CohortIndicator}.
	 * <p>
	 * El {@link CohortIndicator} resultante tiene parámetros "startDate" y "endDate" que deben ser
	 * proporcionados en el {@link org.openmrs.module.reporting.evaluation.EvaluationContext} al
	 * momento de evaluar.
	 * 
	 * @param definition la definición del indicador a traducir
	 * @return un CohortIndicator listo para pasar a EvaluationService
	 * @throws IllegalArgumentException si la definición no tiene conceptos ni rango de edad
	 */
	public CohortIndicator translate(IndicatorDefinition definition) {
		
		/*
		 * Lista para ir acumulando todas las CohortDefinitions parciales.
		 * Cada elemento se usará en la CompositionCohortDefinition.
		 *
		 * CONCEPTO: Mapped<CohortDefinition>
		 * ─────────────────────────────────────
		 * En el Reporting Module, cuando combinas definiciones dentro de una
		 * CompositionCohortDefinition, las envuelves en un "Mapped" que especifica
		 * cómo se pasan los parámetros de la definición padre a la hija.
		 *
		 * Mapped.mapStraightThrough() significa: "pasa los parámetros con el mismo nombre".
		 * Ej: si la composición tiene "startDate", la hija también recibirá "startDate".
		 */
		/*
		 * CONCEPTO: Generics en Java con covarianza (? extends T)
		 * ─────────────────────────────────────────────────────────
		 * Mapped<AgeCohortDefinition> NO es un subtipo de Mapped<CohortDefinition>
		 * (los generics de Java son invariantes).
		 * La solución es usar Mapped<? extends CohortDefinition>, que acepta
		 * Mapped de cualquier subclase de CohortDefinition.
		 */
		List<Mapped<? extends CohortDefinition>> parts = new ArrayList<Mapped<? extends CohortDefinition>>();
		
		// ── 1. Filtro por edad ──────────────────────────────────────────────────
		if (definition.getMinAge() != null || definition.getMaxAge() != null) {
			AgeCohortDefinition ageDef = buildAgeCohortDefinition(definition.getMinAge(), definition.getMaxAge());
			parts.add(Mapped.mapStraightThrough(ageDef));
		}
		
		// ── 2. Filtro por conceptos y frecuencias ───────────────────────────────
		List<String> conceptUuids = definition.getConceptUuids();
		List<Integer> conceptFrequencies = definition.getConceptFrequencies();
		
		if (conceptUuids != null) {
			for (int i = 0; i < conceptUuids.size(); i++) {
				String conceptUuid = conceptUuids.get(i);
				Integer minFrequency = (conceptFrequencies != null && i < conceptFrequencies.size()) ? conceptFrequencies
				        .get(i) : 1;
				
				SqlCohortDefinition sqlDef = buildObsFrequencyCohortDefinition(conceptUuid, minFrequency);
				parts.add(Mapped.mapStraightThrough(sqlDef));
			}
		}
		
		if (parts.isEmpty()) {
			throw new IllegalArgumentException("IndicatorDefinition '" + definition.getName()
			        + "' no tiene condiciones (ni edad ni conceptos).");
		}
		
		// ── 3. Combinar todas las condiciones con AND ───────────────────────────
		CohortDefinition finalCohort;
		
		if (parts.size() == 1) {
			// Si solo hay una condición, no necesitamos composición
			finalCohort = (CohortDefinition) parts.get(0).getParameterizable();
		} else {
			finalCohort = buildCompositionCohortDefinition(parts);
		}
		
		// ── 4. Construir el CohortIndicator ─────────────────────────────────────
		/*
		 * CONCEPTO: CohortIndicator
		 * ──────────────────────────
		 * Un CohortIndicator cuenta pacientes en un cohort. Tipos disponibles:
		 *   - COUNT:    número absoluto de pacientes (lo que queremos)
		 *   - FRACTION: porcentaje (numerador/denominador)
		 *   - LOGIC:    basado en expresión lógica
		 *
		 * setCohortDefinition(def, "startDate=${startDate},endDate=${endDate}")
		 * El segundo argumento es el "mappings string" que conecta los parámetros
		 * del indicador con los parámetros de la CohortDefinition.
		 * "${startDate}" significa: usa el valor del parámetro "startDate" del indicador.
		 */
		CohortIndicator indicator = new CohortIndicator(definition.getName());
		indicator.setType(CohortIndicator.IndicatorType.COUNT);
		indicator.setDescription(definition.getDescription());
		indicator.setCohortDefinition(finalCohort, "startDate=${startDate},endDate=${endDate}");
		
		// Declarar los parámetros del indicador que deben ser provistos en el EvaluationContext
		indicator.addParameter(new Parameter("startDate", "Start Date", java.util.Date.class));
		indicator.addParameter(new Parameter("endDate", "End Date", java.util.Date.class));
		
		return indicator;
	}
	
	// ─────────────────────────────────────────────────────────────────────────
	// Métodos privados de construcción (cada uno construye una pieza)
	// ─────────────────────────────────────────────────────────────────────────
	
	/**
	 * Construye un {@link AgeCohortDefinition} para filtrar pacientes por rango de edad.
	 * <p>
	 * CONCEPTO: AgeCohortDefinition El Reporting Module calcula la edad del paciente en el momento
	 * de la evaluación (usando la fecha "effectiveDate" del EvaluationContext, que por defecto es
	 * hoy). No necesitas calcular edades manualmente.
	 * 
	 * @param minAge edad mínima en años (puede ser null para sin límite inferior)
	 * @param maxAge edad máxima en años (puede ser null para sin límite superior)
	 */
	private AgeCohortDefinition buildAgeCohortDefinition(Integer minAge, Integer maxAge) {
		AgeCohortDefinition ageDef = new AgeCohortDefinition();
		ageDef.setName("Rango de edad: " + minAge + " - " + maxAge);
		
		if (minAge != null) {
			ageDef.setMinAge(minAge);
			// DurationUnit.YEARS es la unidad por defecto en AgeCohortDefinition
		}
		if (maxAge != null) {
			ageDef.setMaxAge(maxAge);
		}
		
		return ageDef;
	}
	
	/**
	 * Construye una {@link SqlCohortDefinition} que encuentra pacientes que tienen observaciones de
	 * un concepto específico al menos {@code minFrequency} veces dentro del rango de fechas
	 * proporcionado en el EvaluationContext.
	 * <p>
	 * CONCEPTO: SqlCohortDefinition vs ObsCohortDefinition
	 * ───────────────────────────────────────────────────────── El Reporting Module tiene dos
	 * formas de filtrar por observaciones: ObsCohortDefinition: configurable con UI, pero solo
	 * filtra "tiene/no tiene" el obs. No soporta fácilmente el conteo de frecuencias mínimas.
	 * SqlCohortDefinition: SQL directo. Más flexible, soporta HAVING COUNT(*) >= N. Ideal cuando
	 * necesitas lógica como "al menos N ocurrencias". VENTAJA de SqlCohortDefinition: el motor de
	 * BD hace el trabajo pesado. No iteramos pacientes en Java, dejamos que SQL filtre
	 * eficientemente. CONCEPTO: Parámetros en SqlCohortDefinition
	 * ───────────────────────────────────────────── El SQL puede usar :parameterName para inyectar
	 * valores del EvaluationContext. Esto previene SQL injection y permite reutilizar la definición
	 * con distintos valores.
	 * 
	 * @param conceptUuid UUID del concepto a buscar
	 * @param minFrequency número mínimo de veces que debe aparecer el concepto
	 */
	private SqlCohortDefinition buildObsFrequencyCohortDefinition(String conceptUuid, Integer minFrequency) {
		
		/*
		 * SQL explicado línea por línea:
		 *
		 * SELECT DISTINCT o.person_id
		 *   → queremos los IDs únicos de pacientes (el Reporting Module necesita una columna
		 *     llamada "patient_id" o "person_id")
		 *
		 * FROM obs o
		 * JOIN concept c ON c.concept_id = o.concept_id
		 *   → tabla de observaciones clínicas de OpenMRS
		 *
		 * WHERE c.uuid = :conceptUuid
		 *   → solo las observaciones del concepto identificado por UUID
		 *
		 * AND o.voided = 0
		 *   → solo registros activos (en OpenMRS, "voided" = borrado lógico)
		 *
		 * AND o.obs_datetime BETWEEN :startDate AND :endDate
		 *   → solo observaciones dentro del período de búsqueda
		 *   → :startDate y :endDate son parámetros que vendrán del EvaluationContext
		 *
		 * GROUP BY o.person_id
		 *   → agrupar por paciente para poder contar
		 *
		 * HAVING COUNT(*) >= :minFrequency
		 *   → solo pacientes que tienen el concepto AL MENOS N veces
		 *   → esto es lo que no puede hacer ObsCohortDefinition fácilmente
		 */
		String sql = "SELECT DISTINCT o.person_id " + "FROM obs o " + "JOIN concept c ON c.concept_id = o.concept_id "
		        + "WHERE c.uuid = :conceptUuid " + "AND o.voided = 0 "
		        + "AND o.obs_datetime BETWEEN :startDate AND :endDate " + "GROUP BY o.person_id "
		        + "HAVING COUNT(*) >= :minFrequency";
		
		SqlCohortDefinition sqlDef = new SqlCohortDefinition(sql);
		sqlDef.setName("Concepto " + conceptUuid + " >= " + minFrequency + " veces");
		
		// Declarar los parámetros que usa este SQL
		// Esto es lo que permite al EvaluationContext inyectar los valores correctos
		sqlDef.addParameter(new Parameter("startDate", "Start Date", java.util.Date.class));
		sqlDef.addParameter(new Parameter("endDate", "End Date", java.util.Date.class));
		sqlDef.addParameter(new Parameter("conceptUuid", "Concept UUID", String.class));
		sqlDef.addParameter(new Parameter("minFrequency", "Min Frequency", Integer.class));
		
		return sqlDef;
	}
	
	/**
	 * Construye una {@link CompositionCohortDefinition} que combina múltiples definiciones con el
	 * operador AND lógico.
	 * <p>
	 * CONCEPTO: CompositionCohortDefinition ────────────────────────────────────────── Es el
	 * "AND/OR/NOT" del Reporting Module. Permite combinar cualquier número de CohortDefinitions.
	 * Sintaxis de la expresión: "1 AND 2 AND 3" → todos los cohorts deben coincidir "1 OR 2" → al
	 * menos uno debe coincidir "1 AND NOT 2" → en el primero pero no en el segundo "(1 AND 2) OR 3"
	 * → combinaciones complejas con paréntesis Cada número hace referencia al índice del search
	 * (1-based) en la lista que se añade con addSearch().
	 * 
	 * @param parts lista de CohortDefinitions mapeadas a combinar
	 */
	private CompositionCohortDefinition buildCompositionCohortDefinition(List<Mapped<? extends CohortDefinition>> parts) {
		
		CompositionCohortDefinition composition = new CompositionCohortDefinition();
		composition.setName("Composición AND de " + parts.size() + " condiciones");
		
		// La CompositionCohortDefinition también necesita los parámetros de fecha
		// para poder pasárselos a sus hijos
		composition.addParameter(new Parameter("startDate", "Start Date", java.util.Date.class));
		composition.addParameter(new Parameter("endDate", "End Date", java.util.Date.class));
		
		// Construir la expresión AND: "1 AND 2 AND 3 AND ..."
		StringBuilder expression = new StringBuilder();
		
		for (int i = 0; i < parts.size(); i++) {
			String key = "def" + (i + 1);
			
			/*
			 * addSearch(key, mapped)
			 * ─────────────────────
			 * Registra una definición hija con un nombre clave.
			 * El key ("def1", "def2"...) se usa en la expresión.
			 * Mapped.mapStraightThrough() pasa los parámetros de la composición
			 * directamente a la definición hija (mismos nombres de parámetros).
			 *
			 * El cast a Mapped es necesario porque addSearch acepta Mapped<? extends CohortDefinition>
			 * pero la firma en algunas versiones usa el tipo raw; el @SuppressWarnings suprime el aviso.
			 */
			@SuppressWarnings("unchecked")
			Mapped<CohortDefinition> mapped = (Mapped<CohortDefinition>) parts.get(i);
			composition.addSearch(key, mapped);
			
			if (i > 0) {
				expression.append(" AND ");
			}
			expression.append(key);
		}
		
		composition.setCompositionString(expression.toString());
		
		return composition;
	}
}
