# NeuroTEA - Sistema de Gestión de Sesiones

## Descripción del Proyecto
Sistema web de gestión para un centro de terapias especializado en TEA (Trastorno del Espectro Autista). Permite registrar sesiones de terapia, gestionar pagos, controlar egresos y generar rendiciones de cuentas.

## Estructura del Proyecto
```
/
├── index_FIXED.html      # Interfaz principal (HTML + Tailwind CSS)
├── neurotea-app_FIXED.js # Lógica de la aplicación (~287KB)
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
- `patientCredits{}`: Créditos/paquetes de pacientes
- `fechaActual`: Fecha actual en formato local

## IndexedDB Stores
- `therapists`: Datos de terapeutas
- `sessions`: Sesiones de terapia
- `egresos`: Gastos y adelantos
- `confirmaciones`: Estados de confirmación de pagos
- `patientCredits`: Créditos de pacientes
- `dailyPackagePurchases`: Paquetes comprados

## Notas de Desarrollo
- El sistema maneja zona horaria de Paraguay (UTC-4)
- Los registros antiguos (>30 días) se limpian automáticamente
- Los colores corporativos usan la variable `--neurotea-blue: #4A90E2`
- Soporte para modo oscuro (dark mode)
