/**
 * This Source Code Form is subject to the terms of the Mozilla Public License,
 * v. 2.0. If a copy of the MPL was not distributed with this file, You can
 * obtain one at http://mozilla.org/MPL/2.0/. OpenMRS is also distributed under
 * the terms of the Healthcare Disclaimer located at http://openmrs.org/license.
 *
 * Copyright (C) OpenMRS Inc. OpenMRS is a registered trademark and the OpenMRS
 * graphic logo is a trademark of OpenMRS Inc.
 */
package org.openmrs.module.indicators.web.controller;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

import org.openmrs.api.APIException;
import org.openmrs.api.context.Context;
import org.openmrs.module.indicators.IndicatorDefinition;
import org.openmrs.module.indicators.api.IndicatorResult;
import org.openmrs.module.indicators.api.IndicatorsService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.ResponseBody;

@Controller("indicators.IndicatorsRestController")
@RequestMapping("/module/indicators/api")
public class IndicatorsRestController {
	
	@RequestMapping(value = "/definitions.form", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
	@ResponseBody
	public List<IndicatorDefinitionResponse> listDefinitions() {
		List<IndicatorDefinition> definitions = getIndicatorsService().getAllIndicatorDefinitions();
		List<IndicatorDefinitionResponse> response = new ArrayList<IndicatorDefinitionResponse>();
		for (IndicatorDefinition definition : definitions) {
			response.add(toResponse(definition));
		}
		return response;
	}
	
	@RequestMapping(value = "/definitions/{id}.form", method = RequestMethod.GET, produces = MediaType.APPLICATION_JSON_VALUE)
	public ResponseEntity<?> getDefinition(@PathVariable("id") Integer id) {
		IndicatorDefinition definition = getIndicatorsService().getIndicatorDefinition(id);
		if (definition == null) {
			return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
			    new ErrorResponse("No se encontró IndicatorDefinition con ID: " + id));
		}
		return ResponseEntity.ok(toResponse(definition));
	}
	
	@RequestMapping(value = "/definitions.form", method = RequestMethod.POST, consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
	public ResponseEntity<?> createDefinition(@RequestBody CreateIndicatorDefinitionRequest request) {
		String validationError = validateCreateRequest(request);
		if (validationError != null) {
			return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ErrorResponse(validationError));
		}
		
		try {
			IndicatorDefinition definition = new IndicatorDefinition();
			definition.setName(request.getName().trim());
			definition.setDescription(request.getDescription());
			definition.setConceptUuids(request.getConceptUuids());
			definition.setConceptFrequencies(request.getConceptFrequencies());
			definition.setMinAge(request.getMinAge());
			definition.setMaxAge(request.getMaxAge());
			definition.setStartDate(parseDateOrNull(request.getStartDate()));
			definition.setEndDate(parseDateOrNull(request.getEndDate()));
			
			IndicatorDefinition saved = getIndicatorsService().saveIndicatorDefinition(definition);
			return ResponseEntity.status(HttpStatus.CREATED).body(toResponse(saved));
		}
		catch (ParseException e) {
			return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
			    new ErrorResponse("Formato de fecha inválido. Usa yyyy-MM-dd."));
		}
		catch (APIException e) {
			return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ErrorResponse(e.getMessage()));
		}
	}
	
	@RequestMapping(value = "/definitions/{id}/evaluate.form", method = RequestMethod.POST, consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
	public ResponseEntity<?> evaluate(@PathVariable("id") Integer id,
	        @RequestBody(required = false) EvaluateIndicatorRequest request) {
		try {
			Date startDate = parseDateOrNull(request != null ? request.getStartDate() : null);
			Date endDate = parseDateOrNull(request != null ? request.getEndDate() : null);
			IndicatorResult result = getIndicatorsService().evaluateIndicator(id, startDate, endDate);
			return ResponseEntity.ok(new IndicatorResultResponse(result));
		}
		catch (ParseException e) {
			return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
			    new ErrorResponse("Formato de fecha inválido. Usa yyyy-MM-dd."));
		}
		catch (IllegalArgumentException e) {
			return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ErrorResponse(e.getMessage()));
		}
		catch (APIException e) {
			HttpStatus status = e.getMessage() != null && e.getMessage().contains("No se encontró IndicatorDefinition") ? HttpStatus.NOT_FOUND
			        : HttpStatus.INTERNAL_SERVER_ERROR;
			return ResponseEntity.status(status).body(new ErrorResponse(e.getMessage()));
		}
	}
	
	private IndicatorsService getIndicatorsService() {
		return Context.getService(IndicatorsService.class);
	}
	
	private String validateCreateRequest(CreateIndicatorDefinitionRequest request) {
		if (request == null) {
			return "El body JSON es obligatorio.";
		}
		if (request.getName() == null || request.getName().trim().isEmpty()) {
			return "El campo 'name' es obligatorio.";
		}
		if (request.getConceptUuids() == null || request.getConceptUuids().isEmpty()) {
			return "El campo 'conceptUuids' debe tener al menos un concepto.";
		}
		if (request.getConceptFrequencies() != null
		        && request.getConceptFrequencies().size() != request.getConceptUuids().size()) {
			return "'conceptFrequencies' debe tener el mismo tamaño que 'conceptUuids'.";
		}
		for (String conceptUuid : request.getConceptUuids()) {
			if (conceptUuid == null || conceptUuid.trim().isEmpty()) {
				return "Cada valor de 'conceptUuids' debe ser un UUID no vacío.";
			}
		}
		if (request.getMinAge() != null && request.getMaxAge() != null && request.getMinAge() > request.getMaxAge()) {
			return "'minAge' no puede ser mayor que 'maxAge'.";
		}
		return null;
	}
	
	private IndicatorDefinitionResponse toResponse(IndicatorDefinition definition) {
		IndicatorDefinitionResponse response = new IndicatorDefinitionResponse();
		response.setId(definition.getId());
		response.setName(definition.getName());
		response.setDescription(definition.getDescription());
		response.setConceptUuids(definition.getConceptUuids());
		response.setConceptFrequencies(definition.getConceptFrequencies());
		response.setMinAge(definition.getMinAge());
		response.setMaxAge(definition.getMaxAge());
		response.setStartDate(formatDate(definition.getStartDate()));
		response.setEndDate(formatDate(definition.getEndDate()));
		return response;
	}
	
	private Date parseDateOrNull(String value) throws ParseException {
		if (value == null || value.trim().isEmpty()) {
			return null;
		}
		SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
		formatter.setLenient(false);
		return formatter.parse(value.trim());
	}
	
	private String formatDate(Date date) {
		if (date == null) {
			return null;
		}
		SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
		return formatter.format(date);
	}
	
	public static class CreateIndicatorDefinitionRequest {
		
		private String name;
		
		private String description;
		
		private List<String> conceptUuids;
		
		private List<Integer> conceptFrequencies;
		
		private Integer minAge;
		
		private Integer maxAge;
		
		private String startDate;
		
		private String endDate;
		
		public String getName() {
			return name;
		}
		
		public void setName(String name) {
			this.name = name;
		}
		
		public String getDescription() {
			return description;
		}
		
		public void setDescription(String description) {
			this.description = description;
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
		
		public String getStartDate() {
			return startDate;
		}
		
		public void setStartDate(String startDate) {
			this.startDate = startDate;
		}
		
		public String getEndDate() {
			return endDate;
		}
		
		public void setEndDate(String endDate) {
			this.endDate = endDate;
		}
	}
	
	public static class EvaluateIndicatorRequest {
		
		private String startDate;
		
		private String endDate;
		
		public String getStartDate() {
			return startDate;
		}
		
		public void setStartDate(String startDate) {
			this.startDate = startDate;
		}
		
		public String getEndDate() {
			return endDate;
		}
		
		public void setEndDate(String endDate) {
			this.endDate = endDate;
		}
	}
	
	public static class IndicatorDefinitionResponse {
		
		private Integer id;
		
		private String name;
		
		private String description;
		
		private List<String> conceptUuids;
		
		private List<Integer> conceptFrequencies;
		
		private Integer minAge;
		
		private Integer maxAge;
		
		private String startDate;
		
		private String endDate;
		
		public Integer getId() {
			return id;
		}
		
		public void setId(Integer id) {
			this.id = id;
		}
		
		public String getName() {
			return name;
		}
		
		public void setName(String name) {
			this.name = name;
		}
		
		public String getDescription() {
			return description;
		}
		
		public void setDescription(String description) {
			this.description = description;
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
		
		public String getStartDate() {
			return startDate;
		}
		
		public void setStartDate(String startDate) {
			this.startDate = startDate;
		}
		
		public String getEndDate() {
			return endDate;
		}
		
		public void setEndDate(String endDate) {
			this.endDate = endDate;
		}
	}
	
	public static class IndicatorResultResponse {
		
		private final Integer indicatorDefinitionId;
		
		private final String indicatorName;
		
		private final long count;
		
		private final String startDate;
		
		private final String endDate;
		
		public IndicatorResultResponse(IndicatorResult result) {
			this.indicatorDefinitionId = result.getIndicatorDefinitionId();
			this.indicatorName = result.getIndicatorName();
			this.count = result.getCount();
			this.startDate = format(result.getStartDate());
			this.endDate = format(result.getEndDate());
		}
		
		private String format(Date date) {
			if (date == null) {
				return null;
			}
			SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd");
			return formatter.format(date);
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
		
		public String getStartDate() {
			return startDate;
		}
		
		public String getEndDate() {
			return endDate;
		}
	}
	
	public static class ErrorResponse {
		
		private final String error;
		
		public ErrorResponse(String error) {
			this.error = error;
		}
		
		public String getError() {
			return error;
		}
	}
}
