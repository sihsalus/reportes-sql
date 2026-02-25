/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators.api.impl;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.openmrs.api.APIException;
import org.openmrs.api.UserService;
import org.openmrs.api.impl.BaseOpenmrsService;
import org.openmrs.module.indicators.IndicatorDefinition;
import org.openmrs.module.indicators.Item;
import org.openmrs.module.indicators.api.IndicatorResult;
import org.openmrs.module.indicators.api.IndicatorTranslator;
import org.openmrs.module.indicators.api.IndicatorsService;
import org.openmrs.module.indicators.api.dao.IndicatorsDao;
import org.openmrs.module.reporting.evaluation.EvaluationContext;
import org.openmrs.module.reporting.evaluation.EvaluationException;
import org.openmrs.module.reporting.indicator.CohortIndicator;
import org.openmrs.module.reporting.indicator.CohortIndicatorResult;
import org.openmrs.module.reporting.indicator.service.IndicatorService;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Implementación del servicio de indicadores.
 * <p>
 * CONCEPTO: La capa de servicio (Service Layer) ────────────────────────────────────────────── Esta
 * clase orquesta el flujo: cargar datos → traducir → evaluar → retornar resultado. No sabe cómo se
 * almacenan los datos (eso es el DAO) ni cómo se evalúan (Reporting Module).
 * <p>
 * CONCEPTO: BaseOpenmrsService Clase base de OpenMRS para servicios. Proporciona hooks de ciclo de
 * vida del módulo.
 */
public class IndicatorsServiceImpl extends BaseOpenmrsService implements IndicatorsService {
	
	// Inyectado desde moduleApplicationContext.xml (patrón del starter de OpenMRS)
	IndicatorsDao dao;
	
	UserService userService;
	
	/*
	 * CONCEPTO: @Autowired en una clase instanciada desde XML
	 * ─────────────────────────────────────────────────────────
	 * Aunque esta clase se define en el XML (como target del TransactionProxyFactoryBean),
	 * Spring igualmente procesa las anotaciones @Autowired porque el XML ya tiene activado
	 * <context:component-scan base-package="org.openmrs.module.indicators"/>.
	 *
	 * IndicatorTranslator está anotado con @Component → Spring lo encontrará.
	 * IndicatorService del Reporting Module está registrado como bean de Spring
	 * por el Reporting Module → Spring también lo inyectará aquí.
	 */
	@Autowired
	private IndicatorTranslator indicatorTranslator;
	
	/*
	 * CONCEPTO: IndicatorService del Reporting Module
	 * ─────────────────────────────────────────────────
	 * El Reporting Module registra su propio servicio en el contexto Spring de OpenMRS.
	 * Spring lo inyecta aquí por tipo (IndicatorService).
	 *
	 * require_modules en config.xml garantiza que el Reporting Module ya arrancó
	 * antes de que tu módulo intente usarlo.
	 */
	@Autowired
	private IndicatorService reportingIndicatorService;
	
	// ─── Setters para inyección XML ───────────────────────────────────────────
	
	/** Injected in moduleApplicationContext.xml */
	public void setDao(IndicatorsDao dao) {
		this.dao = dao;
	}
	
	/** Injected in moduleApplicationContext.xml */
	public void setUserService(UserService userService) {
		this.userService = userService;
	}
	
	// ─── API original (Items de ejemplo) ─────────────────────────────────────
	
	@Override
	public Item getItemByUuid(String uuid) throws APIException {
		return dao.getItemByUuid(uuid);
	}
	
	@Override
	public Item saveItem(Item item) throws APIException {
		if (item.getOwner() == null) {
			item.setOwner(userService.getUser(1));
		}
		return dao.saveItem(item);
	}
	
	// ─── API de IndicatorDefinition ───────────────────────────────────────────
	
	@Override
	public IndicatorDefinition saveIndicatorDefinition(IndicatorDefinition definition) throws APIException {
		return dao.saveIndicatorDefinition(definition);
	}
	
	@Override
	public IndicatorDefinition getIndicatorDefinition(Integer id) throws APIException {
		return dao.getIndicatorDefinition(id);
	}
	
	@Override
	public List<IndicatorDefinition> getAllIndicatorDefinitions() throws APIException {
		return dao.getAllIndicatorDefinitions();
	}
	
	/**
	 * Evalúa un indicador usando el Reporting Module como motor de evaluación.
	 * <p>
	 * FLUJO DETALLADO:
	 * 
	 * <pre>
	 *   1. Carga IndicatorDefinition desde BD (via DAO)
	 *      │
	 *   2. IndicatorTranslator.translate() → CohortIndicator
	 *      │  (construye AgeCohortDef + SqlCohortDefs + CompositionCohortDef)
	 *      │
	 *   3. Construye EvaluationContext con las fechas
	 *      │
	 *   4. reportingIndicatorService.evaluate(indicator, context)
	 *      │  → retorna CohortIndicatorResult (subclase de IndicatorResult del reporting)
	 *      │  → el Reporting Module ejecuta SQL en BD, NUNCA iteramos pacientes en Java
	 *      │
	 *   5. Extrae el valor numérico con getValue()
	 *      │
	 *   6. Retorna nuestro IndicatorResult (DTO propio, desacoplado del reporting)
	 * </pre>
	 */
	@Override
	public IndicatorResult evaluateIndicator(Integer indicatorDefinitionId, Date startDate, Date endDate)
	        throws APIException {
		
		// ── 1. Cargar la definición ──────────────────────────────────────────
		IndicatorDefinition definition = dao.getIndicatorDefinition(indicatorDefinitionId);
		if (definition == null) {
			throw new APIException("No se encontró IndicatorDefinition con ID: " + indicatorDefinitionId);
		}
		
		// Las fechas del parámetro tienen prioridad; si son null, usamos las del IndicatorDefinition
		Date effectiveStartDate = (startDate != null) ? startDate : definition.getStartDate();
		Date effectiveEndDate = (endDate != null) ? endDate : definition.getEndDate();
		
		if (effectiveStartDate == null || effectiveEndDate == null) {
			throw new IllegalArgumentException("El indicador '" + definition.getName()
			        + "' requiere startDate y endDate para ser evaluado.");
		}
		
		// ── 2. Traducir a CohortIndicator ────────────────────────────────────
		CohortIndicator cohortIndicator = indicatorTranslator.translate(definition);
		
		// ── 3. Construir EvaluationContext ───────────────────────────────────
		/*
		 * CONCEPTO: EvaluationContext
		 * ────────────────────────────
		 * Contiene los parámetros concretos que el Reporting Module inyectará en el SQL.
		 * Los nombres de los parámetros DEBEN coincidir exactamente con los declarados
		 * en las CohortDefinitions mediante addParameter(...).
		 * Mapped.mapStraightThrough() se encarga de propagar estos parámetros
		 * a las definiciones anidadas.
		 */
		EvaluationContext context = new EvaluationContext();
		Map<String, Object> parameterValues = new HashMap<String, Object>();
		parameterValues.put("startDate", effectiveStartDate);
		parameterValues.put("endDate", effectiveEndDate);
		context.setParameterValues(parameterValues);
		
		// ── 4. Evaluar usando el Reporting Module ────────────────────────────
		/*
		 * CONCEPTO: IndicatorService.evaluate()
		 * ───────────────────────────────────────
		 * Recibe el CohortIndicator y el EvaluationContext.
		 * Internamente el Reporting Module:
		 *   1. Evalúa cada CohortDefinition anidada → SQL → Set<Integer> de patient_ids
		 *   2. Calcula la intersección AND (CompositionCohortDefinition)
		 *   3. Cuenta el cohort resultante
		 *   4. Retorna un CohortIndicatorResult con getValue() = número de pacientes
		 *
		 * Todo ocurre en la BD. No iteramos pacientes en memoria Java.
		 */
		org.openmrs.module.reporting.indicator.IndicatorResult rawResult;
		try {
			rawResult = reportingIndicatorService.evaluate(cohortIndicator, context);
		}
		catch (EvaluationException e) {
			throw new APIException("Error al evaluar el indicador '" + definition.getName() + "': " + e.getMessage(), e);
		}
		
		// ── 5. Extraer el valor numérico ─────────────────────────────────────
		/*
		 * CONCEPTO: CohortIndicatorResult
		 * ────────────────────────────────
		 * Para un CohortIndicator de tipo COUNT, el reporting module retorna
		 * un CohortIndicatorResult. Su método getValue() retorna el conteo
		 * de pacientes en el cohort evaluado.
		 *
		 * Usamos la interfaz IndicatorResult del reporting para el tipo de rawResult,
		 * y lo casteamos a CohortIndicatorResult para acceder a getValue().
		 */
		long count = 0L;
		if (rawResult instanceof CohortIndicatorResult) {
			CohortIndicatorResult cohortResult = (CohortIndicatorResult) rawResult;
			Number value = cohortResult.getValue();
			if (value != null) {
				count = value.longValue();
			}
		}
		
		// ── 6. Retornar nuestro DTO (desacoplado del Reporting Module) ────────
		return new IndicatorResult(indicatorDefinitionId, definition.getName(), count, effectiveStartDate, effectiveEndDate);
	}
}
