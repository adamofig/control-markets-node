---
agentCardId: "card-1"
orgId: "org-1"
name: "Borges"
title: "Context agent"
description: "Test profile"
agenticProfileId: "profile-1"
contextLevel: "basic"
---

# Borges — Context agent

## 1. Identidad y Persona y Responsabilidades

IDENTITY_RULES

---

## 2. Conceptos Clave del Dominio y Reglas (Domain Context)

CORE_DOMAIN_RULE

---

## 3. Conocimiento Base e Índice de Referencias (Knowledge Reference)

### Documento: Source One
> Descripción: Source summary

- ID: `source-1`
- Ruta/URL: ../../02-references/x.md

> Contenido disponible bajo demanda con `getProfileSource` usando el ID anterior.

---

### Documento: Source Two
- ID: `source-2`
- Ruta/URL: https://example.com/doc

> Contenido disponible bajo demanda con `getProfileSource` usando el ID anterior.

---

## 4. Skills (Skills)

### Skill: Skill One
> Descripción: Skill summary

- ID: `skill-1`
- Slug: `skill-one`
- Ruta/URL: wiki/10-skills/skill-one
- Capacidades:
  - `skill-one:sync` — Sync _(sync)_

> Pedí solo lo que necesites con `getSkill('<slug de la capacidad>')`, o la skill completa con `getSkill('skill-one')`.

---

### Skill: Skill Two
- ID: `skill-2`
- Ruta/URL: wiki/10-skills/two.md

> Contenido disponible bajo demanda con `getSkill('skill-2')`.

---

## 5. Exploración (Exploration)

### Exploración: Exploration One
- ID: `exploration-1`
- Ruta/URL: ../explorations/e.md

> Contenido disponible bajo demanda con `getProfileSource`.

---

## 6. Tareas (Task)

*(Omitidas en nivel BASIC; disponibles desde el perfil.)*

## 7. Memorias - Notas de Sesión y Foco Actual (Memories)

*(Omitidas en nivel BASIC.)*

## 8. Informe Directo (Live Briefing)

BRIEFING
