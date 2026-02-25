/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators.api.dao;

import java.util.List;

import org.hibernate.criterion.Restrictions;
import org.openmrs.api.db.hibernate.DbSession;
import org.openmrs.api.db.hibernate.DbSessionFactory;
import org.openmrs.module.indicators.IndicatorDefinition;
import org.openmrs.module.indicators.Item;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;

/*
 * CONCEPTO: @Repository y la capa DAO
 * ────────────────────────────────────
 * DAO = Data Access Object. Es el patrón que encapsula toda la lógica de acceso a BD.
 * El servicio (IndicatorsServiceImpl) no sabe si la BD es MySQL, PostgreSQL o una BD en memoria.
 * Solo llama métodos del DAO y este se encarga de la implementación con Hibernate.
 *
 * @Repository es una anotación de Spring que:
 * 1. Marca la clase como bean de Spring (Spring la gestiona)
 * 2. Activa la traducción de excepciones de Hibernate a excepciones de Spring
 *
 * DbSessionFactory es la fábrica de sesiones Hibernate de OpenMRS.
 * Una "sesión" es la conexión activa con la BD para una transacción.
 */

@Repository("indicators.IndicatorsDao")
public class IndicatorsDao {
	
	@Autowired
	DbSessionFactory sessionFactory;
	
	private DbSession getSession() {
		return sessionFactory.getCurrentSession();
	}
	
	// ─── Items (API original de ejemplo) ─────────────────────────────────────
	
	public Item getItemByUuid(String uuid) {
		return (Item) getSession().createCriteria(Item.class).add(Restrictions.eq("uuid", uuid)).uniqueResult();
	}
	
	public Item saveItem(Item item) {
		getSession().saveOrUpdate(item);
		return item;
	}
	
	// ─── IndicatorDefinition ─────────────────────────────────────────────────
	
	/**
	 * Persiste o actualiza un IndicatorDefinition.
	 * <p>
	 * CONCEPTO: saveOrUpdate de Hibernate Si el objeto tiene ID (ya existe en BD) → UPDATE Si el
	 * objeto no tiene ID (es nuevo) → INSERT + asigna ID generado
	 * 
	 * @param definition la definición a guardar
	 * @return la misma instancia con ID asignado si era nueva
	 */
	public IndicatorDefinition saveIndicatorDefinition(IndicatorDefinition definition) {
		getSession().saveOrUpdate(definition);
		return definition;
	}
	
	/**
	 * Busca un IndicatorDefinition por su ID primario.
	 * <p>
	 * CONCEPTO: session.get() vs session.load() - get(): hace la consulta inmediatamente, retorna
	 * null si no existe - load(): retorna un proxy lazy, lanza excepción si no existe Usamos get()
	 * porque queremos null si no existe (más seguro).
	 * 
	 * @param id el ID a buscar
	 * @return la definición encontrada o null
	 */
	public IndicatorDefinition getIndicatorDefinition(Integer id) {
		return (IndicatorDefinition) getSession().get(IndicatorDefinition.class, id);
	}
	
	/**
	 * Retorna todas las definiciones que no están "retiradas" (retired = false).
	 * <p>
	 * CONCEPTO: "retired" en OpenMRS En OpenMRS, los registros raramente se borran físicamente
	 * (DELETE). En su lugar se "retiran" (retired = true) para mantener historial. Es el
	 * equivalente a un soft delete. La interfaz de usuario los oculta, pero siguen en la BD para
	 * auditoría.
	 * 
	 * @return lista de definiciones activas (no retiradas)
	 */
	@SuppressWarnings("unchecked")
	public List<IndicatorDefinition> getAllIndicatorDefinitions() {
		return getSession().createCriteria(IndicatorDefinition.class).add(Restrictions.eq("retired", false)).list();
	}
}
