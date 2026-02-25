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
import java.util.List;

import org.openmrs.annotation.Authorized;
import org.openmrs.api.APIException;
import org.openmrs.api.OpenmrsService;
import org.openmrs.module.indicators.IndicatorDefinition;
import org.openmrs.module.indicators.IndicatorsConfig;
import org.openmrs.module.indicators.Item;
import org.springframework.transaction.annotation.Transactional;

/**
 * The main service of this module, which is exposed for other modules. See
 * moduleApplicationContext.xml on how it is wired up.
 * <p>
 * CONCEPTO: OpenmrsService e interceptores ───────────────────────────────────────────── Al
 * extender OpenmrsService, OpenMRS envuelve automáticamente este servicio con: - Gestión de
 * transacciones (cada método @Transactional abre/cierra la transacción) - Auditoría (setea
 * dateCreated, changedBy, etc. automáticamente) - Control de acceso (@Authorized verifica
 * privilegios del usuario actual) - Manejo de sesión Hibernate Tú declaras la INTERFAZ aquí. La
 * implementación va en IndicatorsServiceImpl. Spring inyectará la implementación cuando alguien
 * llame Context.getService(IndicatorsService.class).
 */
public interface IndicatorsService extends OpenmrsService {
	
	// ─── API original (Items de ejemplo) ─────────────────────────────────────
	
	@Authorized()
	@Transactional(readOnly = true)
	Item getItemByUuid(String uuid) throws APIException;
	
	@Authorized(IndicatorsConfig.MODULE_PRIVILEGE)
	@Transactional
	Item saveItem(Item item) throws APIException;
	
	// ─── API de IndicatorDefinition ───────────────────────────────────────────
	
	/**
	 * Guarda o actualiza una definición de indicador en la base de datos.
	 * <p>
	 * Si el indicador no tiene ID, se crea. Si ya tiene ID, se actualiza.
	 * 
	 * @param definition la definición a guardar
	 * @return la definición guardada (con ID asignado si era nueva)
	 * @throws APIException si hay error de persistencia
	 */
	@Authorized(IndicatorsConfig.MODULE_PRIVILEGE)
	@Transactional
	IndicatorDefinition saveIndicatorDefinition(IndicatorDefinition definition) throws APIException;
	
	/**
	 * Obtiene una definición de indicador por su ID numérico.
	 * 
	 * @param id el ID de la definición
	 * @return la definición encontrada, o null si no existe
	 * @throws APIException si hay error de acceso a BD
	 */
	@Authorized()
	@Transactional(readOnly = true)
	IndicatorDefinition getIndicatorDefinition(Integer id) throws APIException;
	
	/**
	 * Obtiene todas las definiciones de indicadores activas (no retiradas).
	 * 
	 * @return lista de definiciones activas (puede estar vacía, nunca null)
	 * @throws APIException si hay error de acceso a BD
	 */
	@Authorized()
	@Transactional(readOnly = true)
	List<IndicatorDefinition> getAllIndicatorDefinitions() throws APIException;
	
	/**
	 * Evalúa un indicador y retorna el conteo real de pacientes que cumplen las condiciones
	 * definidas.
	 * <p>
	 * FLUJO INTERNO:
	 * <ol>
	 * <li>Carga el {@link IndicatorDefinition} desde la BD</li>
	 * <li>Lo pasa a {@link IndicatorTranslator} para obtener un CohortIndicator</li>
	 * <li>Crea un EvaluationContext con las fechas proporcionadas</li>
	 * <li>Llama al EvaluationService del Reporting Module</li>
	 * <li>Extrae el conteo y lo retorna en un {@link IndicatorResult}</li>
	 * </ol>
	 * <p>
	 * Las fechas del parámetro sobreescriben las del IndicatorDefinition si se proporcionan. Si son
	 * null, se usan las fechas almacenadas en el IndicatorDefinition.
	 * 
	 * @param indicatorDefinitionId ID del indicador a evaluar
	 * @param startDate inicio del período de evaluación (puede ser null)
	 * @param endDate fin del período de evaluación (puede ser null)
	 * @return el resultado con el conteo de pacientes
	 * @throws APIException si el indicador no existe o hay error de evaluación
	 * @throws IllegalArgumentException si no se pueden determinar las fechas
	 */
	@Authorized()
	@Transactional(readOnly = true)
	IndicatorResult evaluateIndicator(Integer indicatorDefinitionId, Date startDate, Date endDate) throws APIException;
}
