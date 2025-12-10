# NeuroTEA - Sistema de Gestión de Sesiones

## Descripción del Proyecto
Sistema web de gestión para un centro de terapias especializado en TEA (Trastorno del Espectro Autista). Permite registrar sesiones de terapia, gestionar pagos, controlar egresos y generar rendiciones de cuentas.

## Estructura del Proyecto
```
/
├── index_FIXED.html      # Interfaz principal (HTML + Tailwind CSS)
├── neurotea-app_FIXED.js # Lógica de la aplicación (~300KB)
└── CLAUDE.md             # Este archivo
```

## Stack Tecnológico
- **Frontend**: HTML5, Tailwind CSS (CDN), JavaScript vanilla
- **Iconos**: Lucide Icons
- **PDF**: jsPDF + jspdf-autotable + html2pdf.js
- **Base de datos**: IndexedDB (almacenamiento local del navegador)
- **Sin backend**: Aplicación 100% cliente

## Módulos Principales
1. **Registro Diario**: Registro de sesiones con desglose de pagos (efectivo, transferencias)
2. **Resumen Global**: Dashboard con totales del día
3. **Transferencias**: Seguimiento de transferencias pendientes/confirmadas
4. **Rendición de Cuentas**: Resumen por terapeuta con generación de PDF
5. **Egresos**: Gastos de NeuroTEA y adelantos a terapeutas
6. **Gestión de Terapeutas**: CRUD de terapeutas
7. **Paquetes/Créditos**: Sistema de paquetes de sesiones prepagadas
8. **Administración**: Backup/restore, exportación de datos

## Convenciones de Código
- Variables globales al inicio del archivo JS
- Funciones agrupadas por módulo con comentarios separadores `// ===`
- Uso de async/await para operaciones IndexedDB
- Formato de fecha: `YYYY-MM-DD` (fecha local Paraguay, no UTC)
- Moneda: Guaraníes (Gs) sin decimales

## Clases CSS Importantes
- `.campo-efectivo`: Campos de pago en efectivo (verde)
- `.campo-transferencia-neurotea`: Transferencias a NeuroTEA (azul)
- `.campo-transferencia-terapeuta`: Transferencias a terapeuta (morado)
- `.dashboard-card`: Cards del resumen global
- `.badge-*`: Estados (success, warning, danger, info)

## Variables Globales Clave
- `therapists[]`: Lista de terapeutas
- `sessions{}`: Sesiones indexadas por fecha
- `egresos{}`: Egresos indexadas por fecha
- `patientCredits{}`: Créditos/paquetes de pacientes (por paciente → terapeuta)
- `dailyPackagePurchases{}`: Paquetes comprados indexados por fecha
- `fechaActual`: Fecha actual en formato local

## IndexedDB Stores
- `therapists`: Datos de terapeutas
- `sessions`: Sesiones de terapia
- `egresos`: Gastos y adelantos
- `confirmaciones`: Estados de confirmación de pagos
- `patientCredits`: Créditos de pacientes (keyPath: id)
- `dailyPackagePurchases`: Paquetes comprados (keyPath: id, index: fecha)
- `saldos`: Saldos de efectivo y banco
- `saldosIniciales`: Saldos iniciales por fecha
- `historialSaldos`: Historial de movimientos de saldo
- `transferConfirmationStates`: Estados de confirmación de transferencias

## Sistema de Paquetes/Créditos

### Estructuras de Datos
```javascript
// patientCredits - Créditos en memoria
patientCredits[patientName][therapist] = {
    remaining: number,      // Créditos restantes
    total: number,          // Total original
    packageId: string,      // ID del paquete (ej: "PK-001")
    purchaseDate: string,   // Fecha de compra
    status: 'active'|'used',
    usageHistory: []        // Historial de uso
}
// Puede ser un objeto simple o un array si hay múltiples paquetes

// dailyPackagePurchases - Paquetes por fecha
dailyPackagePurchases[fecha] = [{
    id: string,             // ID único (ej: "PK-001")
    patientName: string,
    therapist: string,
    totalSessions: number,
    cashToNeurotea: number,
    transferToTherapist: number,
    transferToNeurotea: number,
    sessionValue: number,
    purchaseDate: string,
    purchaseTime: string,
    status: 'active'
}]
```

### Funciones Clave del Sistema de Paquetes
- `createIndependentPackage(packageData)`: Crea un nuevo paquete y genera créditos
- `createPatientCredits(creditData)`: Crea créditos para un paciente
- `usePatientCredits(patientName, therapist, sessionId)`: Usa un crédito
- `getPatientCreditsInfo(patientName, therapist)`: Obtiene info de créditos
- `hasAvailableCredits(patientName, therapist)`: Verifica si hay créditos disponibles
- `getPatientsWithCreditsForTherapist(therapist)`: Lista pacientes con créditos
- `updateActivePackagesList()`: Actualiza la vista de paquetes activos
- `eliminarPaqueteIndividual(packageId)`: Elimina paquete de memoria e IndexedDB

### Lógica de Visualización de Paquetes
`updateActivePackagesList()` muestra TODOS los paquetes con créditos disponibles:
1. Itera sobre todas las fechas en `dailyPackagePurchases`
2. Filtra paquetes con `remainingCredits > 0`
3. Elimina automáticamente paquetes agotados
4. Ordena por fecha de compra (más recientes primero)

### Lógica de Eliminación de Paquetes
`eliminarPaqueteIndividual(packageId)` realiza eliminación completa:
1. Elimina de `dailyPackagePurchases` en memoria
2. Elimina de `patientCredits` en memoria
3. Usa `clearPackagesByDate()` para limpiar IndexedDB de esa fecha
4. Re-guarda paquetes restantes de esa fecha
5. Limpia y re-guarda `patientCredits` en IndexedDB (filtrando por packageId)

## Funciones de Persistencia
- `saveToStorageAsync()`: Guarda todos los datos en IndexedDB
- `loadFromStorage()`: Carga todos los datos desde IndexedDB
- `saveToIndexedDB(storeName, data)`: Guarda datos (PUT/UPSERT)
- `loadFromIndexedDB(storeName)`: Carga datos de un store
- `deleteFromIndexedDB(storeName, key)`: Elimina un registro por clave
- `clearPackagesByDate(fecha)`: Elimina todos los paquetes de una fecha específica

## Notas de Desarrollo
- El sistema maneja zona horaria de Paraguay (UTC-4)
- Los registros antiguos (>30 días) se limpian automáticamente (excepto paquetes con créditos)
- Los colores corporativos usan la variable `--neurotea-blue: #4A90E2`
- Soporte para modo oscuro (dark mode)
- IndexedDB usa PUT (upsert), no INSERT - los registros eliminados de memoria deben eliminarse explícitamente de IndexedDB
- Al eliminar paquetes, se debe sincronizar tanto `dailyPackagePurchases` como `patientCredits`

## Troubleshooting Común

### Paquetes "fantasma" que no se eliminan
Si aparecen paquetes que ya fueron eliminados:
1. Abrir DevTools → Application → IndexedDB → NeuroTEADB
2. Verificar `dailyPackagePurchases` y `patientCredits`
3. Eliminar manualmente los registros huérfanos
4. O usar Administración → Restaurar sistema

### Créditos que no se sincronizan
La estructura tiene dos fuentes de verdad:
- `dailyPackagePurchases`: Para visualización de paquetes
- `patientCredits`: Para lógica de créditos disponibles
Ambas deben estar sincronizadas. Si hay inconsistencias, verificar ambos stores en IndexedDB.
