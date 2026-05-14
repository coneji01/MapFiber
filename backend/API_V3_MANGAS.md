# API REST V3 — Modelo de Mangas, Hilos y Splitters

## Base URL: `http://<server>:3010/api/v3`

---

## 1. 📦 ENTRADA_CABLE_MANGA (Cables dentro de Mangas)

### `GET /api/v3/mangas/:id/cables`
Lista todos los cables que entran/salen de una manga.

**Response:**
```json
{
  "manga_id": 1,
  "manga_name": "Manga Principal",
  "cables_entrando": [
    {
      "id": 1,
      "cable_id": 5,
      "cable_name": "Cable-Alimentador",
      "tipo": "atraviesa",
      "cable_continuacion_id": 6,
      "continuacion_name": "Cable-Alimentador_cont",
      "total_hilos": 12,
      "hilos_pasantes": 10,
      "hilos_cortados": 2
    }
  ],
  "cables_saliendo": [
    {
      "id": 2,
      "cable_id": 6,
      "cable_name": "Cable-Alimentador_cont",
      "tipo": "inicia_aqui",
      "total_hilos": 10
    }
  ]
}
```

### `POST /api/v3/mangas/:id/cables`
Agrega un cable a una manga (crea `entrada_cable_manga`).

**Body:**
```json
{
  "cable_id": 5,
  "tipo": "atraviesa",
  "cable_continuacion_id": 6
}
```

**Proceso interno:**
1. Crea registro en `entrada_cable_manga`
2. Genera automáticamente N registros en `hilo_dentro_manga` (uno por hilo del cable)
3. Todos los hilos comienzan como `pasante`

### `DELETE /api/v3/mangas/:mangaId/cables/:entradaId`
Saca un cable de una manga.

**Proceso interno:**
1. Marca todos los hilos como `roto` (NO se restauran)
2. Elimina el registro de `entrada_cable_manga`
3. Actualiza `cable_fibers.cortado_en_manga_id = NULL`

---

## 2. 🧵 HILO_DENTRO_MANGA (Gestión de hilos)

### `GET /api/v3/mangas/:id/hilos`
Lista todos los hilos dentro de una manga, agrupados por cable.

**Response:**
```json
{
  "manga_id": 1,
  "hilos": [
    {
      "id": 10,
      "entrada_cable_id": 1,
      "cable_name": "Cable-A",
      "numero_hilo": 1,
      "estado": "fusionado_splitter",
      "splitter_id": 1,
      "splitter_puerto": 0,
      "potencia_db": 2.5,
      "tiene_potencia": true
    },
    {
      "id": 11,
      "entrada_cable_id": 1,
      "cable_name": "Cable-A",
      "numero_hilo": 2,
      "estado": "pasante",
      "potencia_db": null,
      "tiene_potencia": false
    }
  ]
}
```

### `PUT /api/v3/hilos-dentro-manga/:id`
Actualiza el estado de un hilo dentro de una manga.

**Body (opciones):**

**Opción A — Fusionar a otro hilo (empalme cable→cable):**
```json
{
  "estado": "fusionado_fibra",
  "fusionado_a_hilo_id": 20,
  "perdida_db": 0.1
}
```

**Opción B — Conectar a splitter:**
```json
{
  "estado": "fusionado_splitter",
  "splitter_id": 1,
  "splitter_puerto": 0,
  "perdida_db": 0.1
}
```

**Opción C — Dejar suelto:**
```json
{
  "estado": "terminado"
}
```

**Opción D — Deshacer (sacar fibra):**
```json
{
  "estado": "roto"
}
```

### `POST /api/v3/mangas/:id/michelle`
Realiza un sangrado (Michelle): corta hilos específicos y deja el resto pasante.

**Body:**
```json
{
  "cable_id": 5,
  "hilos_a_cortar": [1, 2],
  "splitter_id": 1,
  "nombre": "Michelle Calle A"
}
```

**Proceso:**
1. Los hilos especificados se marcan como `fusionado_splitter`
2. Se conectan a la entrada del splitter
3. El resto de hilos quedan `pasante`
4. Se crea un registro en `michelle_grupo`

---

## 3. 🔀 SPLITTER (Dentro de Manga)

### `GET /api/v3/mangas/:id/splitters`
Lista todos los splitters dentro de una manga.

### `POST /api/v3/mangas/:id/splitters`
Crea un splitter dentro de una manga.

**Body:**
```json
{
  "nombre": "Splitter Calle A",
  "tipo_split": "1:8",
  "puertos": 8
}
```

### `DELETE /api/v3/splitters/:id`
Elimina un splitter y desconecta todos los hilos asociados.

**Proceso:**
1. Marca todos los hilos conectados al splitter como `terminado`
2. Elimina el splitter
3. **NO restaura nada** — los hilos quedan con puntas sueltas

---

## 4. 📏 CABLE_TRAMO (Segmentos)

### `GET /api/v3/cables/:id/tramos`
Lista todos los tramos de un cable entre mangas.

### `POST /api/v3/cables/:id/tramos`
Crea un tramo (cuando un cable atraviesa una manga).

**Body:**
```json
{
  "manga_inicio_id": 1,
  "manga_fin_id": 2,
  "longitud_metros": 500,
  "hilos_presentes": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}
```

---

## 5. 🔗 UTILIDADES

### `GET /api/v3/mangas/:id/topologia`
Vista completa de la topología de una manga.

**Response:**
```json
{
  "manga": { "id": 1, "name": "Manga Principal" },
  "cables_entrada": [...],
  "cables_salida": [...],
  "hilos": [...],
  "splitters": [
    {
      "id": 1,
      "tipo": "1:8",
      "hilo_entrada": { "cable": "Cable-A", "hilo": 1 },
      "salidas": [
        { "puerto": 1, "hilo": {...}, "destino_nap": "NAP-01" },
        { "puerto": 2, "hilo": {...}, "destino_cable": "Cable-B" }
      ]
    }
  ],
  "michelles": [...]
}
```

### `GET /api/v3/cables/:id/ruta-completa`
Traza la ruta completa de un cable a través de todas las mangas.

### `GET /api/v3/hilos/:cableId/:numeroHilo/ruta`
Sigue un hilo específico a través de mangas, splitters y NAPs.
