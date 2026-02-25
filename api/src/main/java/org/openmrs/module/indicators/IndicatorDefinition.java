/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators;

/*
 * CONCEPTO: BaseOpenmrsMetadata vs BaseOpenmrsData
 * ─────────────────────────────────────────────────
 * OpenMRS tiene dos clases base para objetos persistentes:
 *
 *   - BaseOpenmrsData   → para datos clínicos (observaciones, encuentros, etc.)
 *                         Incluye campos de auditoría: creator, dateCreated, voided, etc.
 *
 *   - BaseOpenmrsMetadata → para configuración / definiciones del sistema
 *                           Incluye: uuid, name, description, retired
 *                           Es la correcta para "IndicatorDefinition" porque
 *                           un indicador ES una definición, no un dato clínico.
 *
 * CONCEPTO: @Entity y @Table
 * ──────────────────────────
 * Estas anotaciones le dicen a Hibernate (el ORM que usa OpenMRS) que esta
 * clase Java corresponde a una tabla en la base de datos.
 * Hibernate mapeará automáticamente cada campo a una columna.
 */

import java.util.Date;
import java.util.List;

import javax.persistence.CollectionTable;
import javax.persistence.Column;
import javax.persistence.ElementCollection;
import javax.persistence.Entity;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.JoinColumn;
import javax.persistence.OrderColumn;
import javax.persistence.Table;

import org.openmrs.BaseOpenmrsMetadata;

/**
 * Modelo que representa la definición de un indicador clínico personalizado.
 * <p>
 * Esta clase almacena la configuración del indicador (qué conceptos, qué rango de edad, qué fechas)
 * pero NO ejecuta ninguna lógica. La evaluación la delega el IndicatorTranslator al Reporting
 * Module.
 * <p>
 * Ejemplo de uso: "Pacientes entre 5 y 15 años que tuvieron el concepto 'Fiebre' (UUID xyz-123) al
 * menos 2 veces entre enero y marzo de 2025."
 */
@Entity(name = "indicators.IndicatorDefinition")
@Table(name = "indicators_definition")
public class IndicatorDefinition extends BaseOpenmrsMetadata {
	
	/*
	 * CONCEPTO: @Id y @GeneratedValue
	 * ────────────────────────────────
	 * @Id marca el campo como clave primaria en la tabla.
	 * @GeneratedValue le dice a Hibernate que el valor lo genera la BD
	 * automáticamente (autoincrement), no necesitas asignarlo manualmente.
	 */
	@Id
	@GeneratedValue
	@Column(name = "indicator_definition_id")
	private Integer id;
	
	/*
	 * CONCEPTO: @ElementCollection + @CollectionTable
	 * ─────────────────────────────────────────────────
	 * Un List<String> no puede mapearse directamente a una columna de BD.
	 * @ElementCollection le dice a Hibernate que cree una tabla auxiliar
	 * para almacenar estos valores.
	 *
	 * Tabla "indicators_definition_concept_uuids":
	 *   indicator_definition_id (FK) | concept_uuid
	 *   ───────────────────────────────────────────
	 *   1                            | 47f4c7d2-5f38-4f62-b407-f5a89f8eecf9
	 *   1                            | 9f6f7fd7-8d57-4dc4-bf88-86f311f4fca7
	 *
	 * @OrderColumn garantiza que el orden de la lista se preserve.
	 * Esto es crítico porque conceptUuids[0] debe corresponder a conceptFrequencies[0].
	 */
	@ElementCollection
	@CollectionTable(name = "indicators_definition_concept_uuids", joinColumns = @JoinColumn(name = "indicator_definition_id"))
	@Column(name = "concept_uuid")
	@OrderColumn(name = "concept_order")
	private List<String> conceptUuids;
	
	/**
	 * Frecuencia mínima requerida para cada concepto. La posición i de esta lista corresponde al
	 * concepto en la posición i de conceptUuids. Ejemplo:
	 * conceptUuids=["47f4c7d2-5f38-4f62-b407-f5a89f8eecf9",
	 * "9f6f7fd7-8d57-4dc4-bf88-86f311f4fca7"], conceptFrequencies=[2, 1] significa: primer concepto
	 * debe aparecer >= 2 veces, segundo >= 1 vez.
	 */
	@ElementCollection
	@CollectionTable(name = "indicators_definition_concept_freqs", joinColumns = @JoinColumn(name = "indicator_definition_id"))
	@Column(name = "frequency")
	@OrderColumn(name = "freq_order")
	private List<Integer> conceptFrequencies;
	
	/** Edad mínima del paciente (en años). Null = sin límite inferior. */
	@Column(name = "min_age")
	private Integer minAge;
	
	/** Edad máxima del paciente (en años). Null = sin límite superior. */
	@Column(name = "max_age")
	private Integer maxAge;
	
	/** Inicio del período de observación para buscar los conceptos. */
	@Column(name = "start_date")
	private Date startDate;
	
	/** Fin del período de observación para buscar los conceptos. */
	@Column(name = "end_date")
	private Date endDate;
	
	// ─── Getters y Setters ────────────────────────────────────────────────────
	
	@Override
	public Integer getId() {
		return id;
	}
	
	@Override
	public void setId(Integer id) {
		this.id = id;
	}
	
	public List<String> getConceptUuids() {
		return conceptUuids;
	}
	
	public void setConceptUuids(List<String> conceptUuids) {
		this.conceptUuids = conceptUuids;
	}
	
	public List<Integer> getConceptFrequencies() {
		return conceptFrequencies;
	}
	
	public void setConceptFrequencies(List<Integer> conceptFrequencies) {
		this.conceptFrequencies = conceptFrequencies;
	}
	
	public Integer getMinAge() {
		return minAge;
	}
	
	public void setMinAge(Integer minAge) {
		this.minAge = minAge;
	}
	
	public Integer getMaxAge() {
		return maxAge;
	}
	
	public void setMaxAge(Integer maxAge) {
		this.maxAge = maxAge;
	}
	
	public Date getStartDate() {
		return startDate;
	}
	
	public void setStartDate(Date startDate) {
		this.startDate = startDate;
	}
	
	public Date getEndDate() {
		return endDate;
	}
	
	public void setEndDate(Date endDate) {
		this.endDate = endDate;
	}
}
