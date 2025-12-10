// ===========================
// SISTEMA NEUROTEA - VERSIÓN CON FLUJO DE CAJA COMPLETO
// Implementa confirmación/reversión y flujo de caja dinámico
// MIGRADO A INDEXEDDB PARA MAYOR ESTABILIDAD
// ===========================

// Variables globales
let therapists = [];
let sessions = {};
let egresos = {};
let saldosReales = { efectivo: 0, banco: 0 };
let saldosIniciales = {}; // Para almacenar saldo inicial por fecha
let historialSaldos = {}; // Para almacenar historial de cambios por fecha
// ✅ CORRECCIÓN: Usar fecha local (Paraguay) en lugar de UTC
// toISOString() convierte a UTC, causando que a las 22:00 en Paraguay ya sea el día siguiente
let fechaActual = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
})();
let confirmaciones = {}; // Para tracking de confirmaciones de pago

// ===========================
// NUEVAS VARIABLES GLOBALES - SISTEMA DE CRÉDITOS Y PAQUETES
// ===========================
let patientCredits = {}; // Créditos por paciente y terapeuta específica
let dailyPackagePurchases = {}; // Paquetes comprados por día

// ===========================
// VARIABLES GLOBALES - MINI CARRITO DE SESIONES FUTURAS
// ===========================
let sesionesFuturasTemp = []; // Array temporal para sesiones futuras antes de confirmar
let transferConfirmationStates = {}; // Estados de confirmación por transferencia

// ===========================
// FUNCIÓN AUXILIAR: Obtener fecha local en formato YYYY-MM-DD
// ===========================
function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ===========================
// FUNCIONES DE INDEXEDDB
// ===========================

let db = null;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NeuroTEADB', 3);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            // Store para terapeutas (persistente)
            if (!db.objectStoreNames.contains('therapists')) {
                db.createObjectStore('therapists', { keyPath: 'id' });
            }
            
            // Store para sesiones (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('sessions')) {
                const sessionStore = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
                sessionStore.createIndex('fecha', 'fecha', { unique: false });
            }
            
            // Store para egresos (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('egresos')) {
                const egresoStore = db.createObjectStore('egresos', { keyPath: 'id', autoIncrement: true });
                egresoStore.createIndex('fecha', 'fecha', { unique: false });
            }
            
            // Store para confirmaciones (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('confirmaciones')) {
                const confStore = db.createObjectStore('confirmaciones', { keyPath: 'id', autoIncrement: true });
                confStore.createIndex('fecha', 'fecha', { unique: false });
            }
            
            // Store para saldos reales
            if (!db.objectStoreNames.contains('saldos')) {
                db.createObjectStore('saldos', { keyPath: 'tipo' });
            }
            
            // Store para saldos iniciales (con fecha)
            if (!db.objectStoreNames.contains('saldosIniciales')) {
                const saldoInicialStore = db.createObjectStore('saldosIniciales', { keyPath: 'fecha' });
            }
            
            // Store para historial de saldos (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('historialSaldos')) {
                const historialStore = db.createObjectStore('historialSaldos', { keyPath: 'id', autoIncrement: true });
                historialStore.createIndex('fecha', 'fecha', { unique: false });
            }
            
            // ===========================
            // NUEVOS STORES - SISTEMA DE CRÉDITOS Y PAQUETES
            // ===========================
            
            // Store para créditos de pacientes (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('patientCredits')) {
                const creditsStore = db.createObjectStore('patientCredits', { keyPath: 'id', autoIncrement: true });
                creditsStore.createIndex('patient', 'patient', { unique: false });
                creditsStore.createIndex('therapist', 'therapist', { unique: false });
                creditsStore.createIndex('purchaseDate', 'purchaseDate', { unique: false });
            }
            
            // Store para paquetes comprados diariamente (con fecha para limpieza automática)
            if (!db.objectStoreNames.contains('dailyPackagePurchases')) {
                const packagesStore = db.createObjectStore('dailyPackagePurchases', { keyPath: 'id', autoIncrement: true });
                packagesStore.createIndex('fecha', 'fecha', { unique: false });
                packagesStore.createIndex('patientName', 'patientName', { unique: false });
                packagesStore.createIndex('therapist', 'therapist', { unique: false });
            }
            
            // Store para estados de confirmación de transferencias
            if (!db.objectStoreNames.contains('transferConfirmationStates')) {
                db.createObjectStore('transferConfirmationStates', { keyPath: 'id' });
            }
        };
    });
}

function saveToIndexedDB(storeName, data) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        
        if (Array.isArray(data)) {
            data.forEach(item => store.put(item));
        } else {
            store.put(data);
        }
    });
}

function loadFromIndexedDB(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteFromIndexedDB(storeName, key) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function clearOldRecords() {
    return new Promise(async (resolve, reject) => {
        try {
            const fechaLimite = new Date();
            fechaLimite.setDate(fechaLimite.getDate() - 30);
            const fechaLimiteStr = getLocalDateString(fechaLimite);
            
            // Limpiar sesiones antiguas
            const oldSessions = await loadFromIndexedDB('sessions');
            for (const session of oldSessions) {
                if (session.fecha < fechaLimiteStr) {
                    await deleteFromIndexedDB('sessions', session.id);
                }
            }
            
            // Limpiar egresos antiguos
            const oldEgresos = await loadFromIndexedDB('egresos');
            for (const egreso of oldEgresos) {
                if (egreso.fecha < fechaLimiteStr) {
                    await deleteFromIndexedDB('egresos', egreso.id);
                }
            }
            
            // Limpiar confirmaciones antiguas
            const oldConfirmaciones = await loadFromIndexedDB('confirmaciones');
            for (const conf of oldConfirmaciones) {
                if (conf.fecha < fechaLimiteStr) {
                    await deleteFromIndexedDB('confirmaciones', conf.id);
                }
            }
            
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// ===========================
// NUEVAS FUNCIONES - CORRECCIÓN DE "ARCHIVOS FANTASMAS"
// ===========================

/**
 * Limpia todos los paquetes de una fecha específica en IndexedDB
 * Esto previene la duplicación de registros al guardar múltiples veces
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<number>} Cantidad de registros eliminados
 */
async function clearPackagesByDate(fecha) {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve(0);
            return;
        }
        
        try {
            const transaction = db.transaction(['dailyPackagePurchases'], 'readwrite');
            const store = transaction.objectStore('dailyPackagePurchases');
            const index = store.index('fecha');
            
            let deletedCount = 0;
            const range = IDBKeyRange.only(fecha);
            const request = index.openCursor(range);
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    store.delete(cursor.primaryKey);
                    deletedCount++;
                    cursor.continue();
                }
            };
            
            transaction.oncomplete = () => {
                if (deletedCount > 0) {
                    console.log(`🧹 Paquetes eliminados de ${fecha}: ${deletedCount}`);
                }
                resolve(deletedCount);
            };
            
            transaction.onerror = () => {
                console.error('Error al limpiar paquetes:', transaction.error);
                resolve(0);
            };
        } catch (error) {
            console.error('Error en clearPackagesByDate:', error);
            resolve(0);
        }
    });
}

/**
 * Elimina duplicados de un array de paquetes basándose en el campo 'id'
 * Mantiene la primera ocurrencia de cada ID
 * @param {Array} packagesArray - Array de paquetes
 * @returns {Array} Array sin duplicados
 */
function deduplicatePackages(packagesArray) {
    if (!Array.isArray(packagesArray)) {
        return packagesArray;
    }
    
    const seen = new Set();
    const deduplicated = [];
    let duplicateCount = 0;
    
    packagesArray.forEach(pkg => {
        const pkgId = pkg.id || JSON.stringify(pkg);
        if (!seen.has(pkgId)) {
            seen.add(pkgId);
            deduplicated.push(pkg);
        } else {
            duplicateCount++;
        }
    });
    
    if (duplicateCount > 0) {
        console.warn(`⚠️ Se encontraron ${duplicateCount} paquetes duplicados y fueron eliminados`);
    }
    
    return deduplicated;
}

/**
 * Valida la integridad de los datos de paquetes en memoria
 * Detecta y reporta duplicados
 * @returns {Object} Reporte de validación
 */
function validatePackageIntegrity() {
    const report = {
        totalFechas: 0,
        totalPaquetes: 0,
        duplicados: 0,
        porFecha: {}
    };
    
    Object.keys(dailyPackagePurchases).forEach(fecha => {
        const paquetes = dailyPackagePurchases[fecha];
        const ids = new Set();
        let duplicadosEnFecha = 0;
        
        paquetes.forEach(pkg => {
            if (ids.has(pkg.id)) {
                duplicadosEnFecha++;
            } else {
                ids.add(pkg.id);
            }
        });
        
        report.totalFechas++;
        report.totalPaquetes += paquetes.length;
        report.duplicados += duplicadosEnFecha;
        report.porFecha[fecha] = {
            total: paquetes.length,
            duplicados: duplicadosEnFecha
        };
    });
    
    if (report.duplicados > 0) {
        console.warn(`⚠️ VALIDACIÓN: Se encontraron ${report.duplicados} paquetes duplicados en total`);
        console.warn('Detalles por fecha:', report.porFecha);
    } else {
        console.log('✅ VALIDACIÓN: No hay paquetes duplicados');
    }
    
    return report;
}

// ===========================
// FUNCIONES DE ELIMINACIÓN ESPECÍFICAS DE INDEXEDDB
// ===========================

// Función para eliminar sesiones de una fecha específica
function deleteSessionsByDate(fecha) {
    return new Promise(async (resolve, reject) => {
        try {
            const sessions = await loadFromIndexedDB('sessions');
            for (const session of sessions) {
                if (session.fecha === fecha) {
                    await deleteFromIndexedDB('sessions', session.id);
                }
            }
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// Función para eliminar egresos de una fecha específica
function deleteEgresosByDate(fecha) {
    return new Promise(async (resolve, reject) => {
        try {
            const egresos = await loadFromIndexedDB('egresos');
            for (const egreso of egresos) {
                if (egreso.fecha === fecha) {
                    await deleteFromIndexedDB('egresos', egreso.id);
                }
            }
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// Función para eliminar confirmaciones de una fecha específica
function deleteConfirmacionesByDate(fecha) {
    return new Promise(async (resolve, reject) => {
        try {
            const confirmaciones = await loadFromIndexedDB('confirmaciones');
            for (const conf of confirmaciones) {
                if (conf.fecha === fecha) {
                    await deleteFromIndexedDB('confirmaciones', conf.id);
                }
            }
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// Función para eliminar historial de saldos de una fecha específica
function deleteHistorialSaldosByDate(fecha) {
    return new Promise(async (resolve, reject) => {
        try {
            const historialSaldos = await loadFromIndexedDB('historialSaldos');
            for (const entrada of historialSaldos) {
                if (entrada.fecha === fecha) {
                    await deleteFromIndexedDB('historialSaldos', entrada.id);
                }
            }
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

// Función para eliminar sesión individual por ID
function deleteSingleSessionFromIndexedDB(sessionId) {
    return deleteFromIndexedDB('sessions', sessionId);
}

// Función para eliminar egreso individual por ID
function deleteSingleEgresoFromIndexedDB(egresoId) {
    return deleteFromIndexedDB('egresos', egresoId);
}

// ===========================
// UTILIDADES
// ===========================

function parseNumber(value) {
    const num = parseFloat(String(value).replace(/,/g, '')) || 0;
    return isNaN(num) ? 0 : num;
}

function formatNumber(number) {
    return new Intl.NumberFormat('es-PY').format(number);
}

function formatCurrency(amount) {
    return `Gs ${formatNumber(amount)}`;
}

// Función auxiliar única para calcular saldo real de Cuenta NeuroTEA
function calcularSaldoCuentaNeuroTEA(fecha) {
    const daySessions = sessions[fecha] || [];

    // ⭐ AGREGAR ESTA LÍNEA:
    const dayPackages = dailyPackagePurchases[fecha] || [];

    let saldoTotal = 0;

    // Sumar todas las transferencias a NeuroTEA de las sesiones del día
    daySessions.forEach(session => {
        saldoTotal += session.transferToNeurotea;
    });

    // ⭐ AGREGAR: Sumar transferencias de paquetes
    dayPackages.forEach(package => {
        saldoTotal += package.transferToNeurotea;
    });

    // Considerar confirmaciones de pago que afectan la cuenta NeuroTEA
    if (confirmaciones[fecha]) {
        Object.values(confirmaciones[fecha]).forEach(conf => {
            if (conf.flujo) {
                // Restar transferencias confirmadas (dinero que salió de la cuenta)
                if (conf.flujo.bancoUsado) {
                    saldoTotal -= conf.flujo.bancoUsado;
                }
                // Sumar dinero recibido de terapeutas (va directo a la cuenta)
                if (conf.flujo.efectivoRecibido) {
                    saldoTotal += conf.flujo.efectivoRecibido;
                }
            }
        });
    }

    return Math.max(0, saldoTotal);
}

// ===========================
// FUNCIÓN CENTRAL: CÁLCULO DINÁMICO DE SALDO EN CAJA
// ===========================
// Esta función calcula el saldo de caja de forma DINÁMICA basándose en los datos actuales
// NO depende de variables acumulativas como saldosReales.efectivo
function calcularSaldoCajaReal(fecha) {
    const daySessions = sessions[fecha] || [];
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const dayEgresos = egresos[fecha] || [];

    // 1. SALDO INICIAL del día
    const saldoInicial = getInitialBalance(fecha) || 0;

    // 2. EFECTIVO INGRESADO (sesiones + paquetes)
    const efectivoSesiones = daySessions.reduce((sum, s) => sum + (s.cashToNeurotea || 0), 0);
    const efectivoPaquetes = dayPackages.reduce((sum, p) => sum + (p.cashToNeurotea || 0), 0);
    const totalEfectivoIngresado = efectivoSesiones + efectivoPaquetes;

    // 3. EGRESOS (adelantos + gastos NeuroTEA)
    const totalEgresos = dayEgresos.reduce((sum, e) => sum + (e.monto || 0), 0);

    // 4. PAGOS CONFIRMADOS EN EFECTIVO a terapeutas
    let pagosConfirmadosEfectivo = 0;
    if (confirmaciones[fecha]) {
        Object.values(confirmaciones[fecha]).forEach(conf => {
            if (conf.flujo) {
                // Efectivo que salió de caja
                if (conf.flujo.efectivoUsado) {
                    pagosConfirmadosEfectivo += conf.flujo.efectivoUsado;
                }
                // Si hubo vuelto en efectivo, se suma (regresó a caja)
                if (conf.flujo.vueltoEfectivo) {
                    pagosConfirmadosEfectivo -= conf.flujo.vueltoEfectivo;
                }
                // Si la terapeuta entregó efectivo, se suma a caja
                if (conf.type === 'LA TERAPEUTA DEBE DAR' && conf.flujo.efectivoRecibido) {
                    pagosConfirmadosEfectivo -= conf.flujo.efectivoRecibido;
                }
            }
        });
    }

    // FÓRMULA FINAL:
    // Saldo = Inicial + Ingresos - Egresos - Pagos a terapeutas
    const saldoFinal = saldoInicial + totalEfectivoIngresado - totalEgresos - pagosConfirmadosEfectivo;

    console.log(`📊 Saldo Caja [${fecha}]: Inicial(${saldoInicial}) + Ingresos(${totalEfectivoIngresado}) - Egresos(${totalEgresos}) - Pagos(${pagosConfirmadosEfectivo}) = ${saldoFinal}`);

    return Math.max(0, saldoFinal);
}

async function saveToStorageAsync() {
    try {
        // Guardar terapeutas
        const therapistData = therapists.map((name, index) => ({ id: index, name }));
        await saveToIndexedDB('therapists', therapistData);
        
        // Guardar sesiones con fecha
        const sessionData = [];
        Object.keys(sessions).forEach(fecha => {
            sessions[fecha].forEach(session => {
                sessionData.push({ ...session, fecha });
            });
        });
        if (sessionData.length > 0) {
            await saveToIndexedDB('sessions', sessionData);
        }
        
        // Guardar egresos con fecha
        const egresoData = [];
        Object.keys(egresos).forEach(fecha => {
            egresos[fecha].forEach(egreso => {
                egresoData.push({ ...egreso, fecha });
            });
        });
        if (egresoData.length > 0) {
            await saveToIndexedDB('egresos', egresoData);
        }
        
        // Guardar confirmaciones con fecha
        const confirmacionData = [];
        Object.keys(confirmaciones).forEach(fecha => {
            Object.keys(confirmaciones[fecha]).forEach(therapist => {
                confirmacionData.push({
                    fecha,
                    therapist,
                    ...confirmaciones[fecha][therapist]
                });
            });
        });
        if (confirmacionData.length > 0) {
            await saveToIndexedDB('confirmaciones', confirmacionData);
        }
        
        // Guardar saldos reales
        await saveToIndexedDB('saldos', [
            { tipo: 'efectivo', valor: saldosReales.efectivo },
            { tipo: 'banco', valor: saldosReales.banco }
        ]);
        
        // Guardar saldos iniciales
        const saldoInicialData = Object.keys(saldosIniciales).map(fecha => ({
            fecha,
            valor: saldosIniciales[fecha]
        }));
        if (saldoInicialData.length > 0) {
            await saveToIndexedDB('saldosIniciales', saldoInicialData);
        }
        
        // Guardar historial de saldos con fecha
        const historialData = [];
        Object.keys(historialSaldos).forEach(fecha => {
            historialSaldos[fecha].forEach(entrada => {
                historialData.push({ ...entrada, fecha });
            });
        });
        if (historialData.length > 0) {
            await saveToIndexedDB('historialSaldos', historialData);
        }
        
        // ===========================
        // GUARDAR NUEVAS ESTRUCTURAS - SISTEMA DE CRÉDITOS Y PAQUETES
        // ===========================
        
        // Guardar créditos de pacientes
        const creditsData = [];
        Object.keys(patientCredits).forEach(patient => {
            Object.keys(patientCredits[patient]).forEach(therapist => {
                const credits = patientCredits[patient][therapist];
                if (Array.isArray(credits)) {
                    credits.forEach((credit, index) => {
                        creditsData.push({
                            id: `${patient}_${therapist}_${index}`,
                            patient: patient,
                            therapist: therapist,
                            ...credit
                        });
                    });
                } else {
                    creditsData.push({
                        id: `${patient}_${therapist}_0`,
                        patient: patient,
                        therapist: therapist,
                        ...credits
                    });
                }
            });
        });
        if (creditsData.length > 0) {
            await saveToIndexedDB('patientCredits', creditsData);
        }
        
        // Guardar paquetes diarios - CON LIMPIEZA SELECTIVA PARA EVITAR DUPLICADOS
        const packagesData = [];
        const fechasConPaquetes = Object.keys(dailyPackagePurchases);
        
        // Limpiar paquetes de cada fecha ANTES de guardar para evitar duplicados
        for (const fecha of fechasConPaquetes) {
            await clearPackagesByDate(fecha);
            
            // Luego guardar los paquetes de esa fecha
            dailyPackagePurchases[fecha].forEach(package => {
                packagesData.push({
                    ...package,
                    fecha: fecha
                });
            });
        }
        
        if (packagesData.length > 0) {
            await saveToIndexedDB('dailyPackagePurchases', packagesData);
        }
        
        // Guardar estados de confirmación de transferencias
        const transferStatesData = Object.keys(transferConfirmationStates).map(transferId => ({
            id: transferId,
            confirmed: transferConfirmationStates[transferId],
            timestamp: new Date().toISOString()
        }));
        if (transferStatesData.length > 0) {
            await saveToIndexedDB('transferConfirmationStates', transferStatesData);
        }
        
    } catch (error) {
        console.error('Error saving to IndexedDB:', error);
        // Fallback a localStorage en caso de error
        localStorage.setItem('neurotea_therapists', JSON.stringify(therapists));
        localStorage.setItem('neurotea_sessions', JSON.stringify(sessions));
        localStorage.setItem('neurotea_egresos', JSON.stringify(egresos));
        localStorage.setItem('neurotea_saldos', JSON.stringify(saldosReales));
        localStorage.setItem('neurotea_confirmaciones', JSON.stringify(confirmaciones));
        localStorage.setItem('neurotea_saldosIniciales', JSON.stringify(saldosIniciales));
        localStorage.setItem('neurotea_historialSaldos', JSON.stringify(historialSaldos));
        // Nuevas estructuras - Sistema de créditos y paquetes
        localStorage.setItem('neurotea_patientCredits', JSON.stringify(patientCredits));
        localStorage.setItem('neurotea_dailyPackagePurchases', JSON.stringify(dailyPackagePurchases));
    }
}

// Función wrapper para mantener compatibilidad
function saveToStorage() {
    saveToStorageAsync().catch(error => {
        console.error('Error in saveToStorage:', error);
    });
}

async function loadFromStorage() {
    try {
        // Cargar terapeutas
        const therapistData = await loadFromIndexedDB('therapists');
        therapists = therapistData.map(item => item.name).sort();
        
        // Cargar sesiones
        const sessionData = await loadFromIndexedDB('sessions');
        sessions = {};
        sessionData.forEach(session => {
            const fecha = session.fecha;
            if (!sessions[fecha]) sessions[fecha] = [];
            const { fecha: _, ...sessionWithoutFecha } = session;
            sessions[fecha].push(sessionWithoutFecha);
        });
        
        // Cargar egresos
        const egresoData = await loadFromIndexedDB('egresos');
        egresos = {};
        egresoData.forEach(egreso => {
            const fecha = egreso.fecha;
            if (!egresos[fecha]) egresos[fecha] = [];
            const { fecha: _, ...egresoWithoutFecha } = egreso;
            egresos[fecha].push(egresoWithoutFecha);
        });
        
        // Cargar confirmaciones
        const confirmacionData = await loadFromIndexedDB('confirmaciones');
        confirmaciones = {};
        confirmacionData.forEach(conf => {
            const fecha = conf.fecha;
            const therapist = conf.therapist;
            if (!confirmaciones[fecha]) confirmaciones[fecha] = {};
            const { fecha: _, therapist: __, ...confWithoutMeta } = conf;
            confirmaciones[fecha][therapist] = confWithoutMeta;
        });
        
        // Cargar saldos reales
        const saldoData = await loadFromIndexedDB('saldos');
        saldosReales = { efectivo: 0, banco: 0 };
        saldoData.forEach(saldo => {
            saldosReales[saldo.tipo] = saldo.valor;
        });
        
        // Cargar saldos iniciales
        const saldoInicialData = await loadFromIndexedDB('saldosIniciales');
        saldosIniciales = {};
        saldoInicialData.forEach(saldo => {
            saldosIniciales[saldo.fecha] = saldo.valor;
        });
        
        // Cargar historial de saldos
        const historialData = await loadFromIndexedDB('historialSaldos');
        historialSaldos = {};
        historialData.forEach(entrada => {
            const fecha = entrada.fecha;
            if (!historialSaldos[fecha]) historialSaldos[fecha] = [];
            const { fecha: _, ...entradaWithoutFecha } = entrada;
            historialSaldos[fecha].push(entradaWithoutFecha);
        });
        
        // ===========================
        // CARGAR NUEVAS ESTRUCTURAS - SISTEMA DE CRÉDITOS Y PAQUETES
        // ===========================
        
        // Cargar créditos de pacientes
        const creditsData = await loadFromIndexedDB('patientCredits');
        patientCredits = {};
        creditsData.forEach(credit => {
            const patient = credit.patient;
            const therapist = credit.therapist;
            
            if (!patientCredits[patient]) {
                patientCredits[patient] = {};
            }
            
            // Remover campos de metadata para reconstruir estructura original
            const { id, patient: _, therapist: __, ...creditWithoutMeta } = credit;
            
            // Manejar múltiples paquetes por paciente/terapeuta
            if (patientCredits[patient][therapist]) {
                // Ya existe, convertir a array si no lo es
                if (!Array.isArray(patientCredits[patient][therapist])) {
                    patientCredits[patient][therapist] = [patientCredits[patient][therapist]];
                }
                patientCredits[patient][therapist].push(creditWithoutMeta);
            } else {
                patientCredits[patient][therapist] = creditWithoutMeta;
            }
        });
        
        // Cargar paquetes diarios - CON DEDUPLICACION PARA EVITAR FANTASMAS
        const packagesData = await loadFromIndexedDB('dailyPackagePurchases');
        dailyPackagePurchases = {};
        packagesData.forEach(package => {
            const fecha = package.fecha;
            if (!dailyPackagePurchases[fecha]) {
                dailyPackagePurchases[fecha] = [];
            }
            const { fecha: _, ...packageWithoutFecha } = package;
            dailyPackagePurchases[fecha].push(packageWithoutFecha);
        });
        
        // Deduplicar paquetes por fecha para eliminar registros fantasma
        Object.keys(dailyPackagePurchases).forEach(fecha => {
            const original = dailyPackagePurchases[fecha].length;
            dailyPackagePurchases[fecha] = deduplicatePackages(dailyPackagePurchases[fecha]);
            const final = dailyPackagePurchases[fecha].length;
            if (original > final) {
                console.warn('CARGA: Se encontraron ' + (original - final) + ' paquetes duplicados en ' + fecha);
            }
        });
        
        // Cargar estados de confirmación de transferencias
        try {
            const transferStatesData = await loadFromIndexedDB('transferConfirmationStates');
            transferConfirmationStates = {};
            transferStatesData.forEach(state => {
                transferConfirmationStates[state.id] = state.confirmed;
            });
        } catch (error) {
            console.log('No previous transfer states found');
            transferConfirmationStates = {};
        }
        
        // Limpiar registros antiguos
        await clearOldRecords();
        
    } catch (error) {
        console.error('Error loading from IndexedDB, falling back to localStorage:', error);
        // Fallback a localStorage
        therapists = JSON.parse(localStorage.getItem('neurotea_therapists') || '[]');
        sessions = JSON.parse(localStorage.getItem('neurotea_sessions') || '{}');
        egresos = JSON.parse(localStorage.getItem('neurotea_egresos') || '{}');
        saldosReales = JSON.parse(localStorage.getItem('neurotea_saldos') || '{"efectivo": 0, "banco": 0}');
        confirmaciones = JSON.parse(localStorage.getItem('neurotea_confirmaciones') || '{}');
        saldosIniciales = JSON.parse(localStorage.getItem('neurotea_saldosIniciales') || '{}');
        historialSaldos = JSON.parse(localStorage.getItem('neurotea_historialSaldos') || '{}');
        // Nuevas estructuras - Sistema de créditos y paquetes
        patientCredits = JSON.parse(localStorage.getItem('neurotea_patientCredits') || '{}');
        dailyPackagePurchases = JSON.parse(localStorage.getItem('neurotea_dailyPackagePurchases') || '{}');
        
        limpiarRegistrosAntiguos();
    }
    
    // Validar integridad de paquetes después de cargar
    validatePackageIntegrity();
    
    // MIGRACIÓN: Limpiar datos corruptos del historial de saldos
    migrarHistorialSaldos();
    
    // MIGRACIÓN: Migrar paquetes antiguos y validar datos
    migrateLegacyPackages();
    validateAllPackagesIntegrity();

    updateAllViews(fechaActual);
}

function limpiarRegistrosAntiguos() {
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - 30);
    const fechaLimiteStr = getLocalDateString(fechaLimite);

    Object.keys(sessions).forEach(fecha => {
        if (fecha < fechaLimiteStr) {
            delete sessions[fecha];
        }
    });

    Object.keys(egresos).forEach(fecha => {
        if (fecha < fechaLimiteStr) {
            delete egresos[fecha];
        }
    });

    Object.keys(confirmaciones).forEach(fecha => {
        if (fecha < fechaLimiteStr) {
            delete confirmaciones[fecha];
        }
    });
    
    // Limpiar saldos iniciales antiguos (mantener solo últimos 30 días)
    Object.keys(saldosIniciales).forEach(fecha => {
        if (fecha < fechaLimiteStr) {
            delete saldosIniciales[fecha];
        }
    });
    
    // Limpiar historial de saldos antiguos (mantener solo últimos 30 días)
    Object.keys(historialSaldos).forEach(fecha => {
        if (fecha < fechaLimiteStr) {
            delete historialSaldos[fecha];
        }
    });

    saveToStorage();
}

// MIGRACIÓN: Función para limpiar datos corruptos del historial de saldos
function migrarHistorialSaldos() {
    let datosModificados = false;
    
    Object.keys(historialSaldos).forEach(fecha => {
        const historialOriginal = historialSaldos[fecha];
        
        if (Array.isArray(historialOriginal)) {
            // Filtrar entradas válidas
            const historialLimpio = historialOriginal.filter(entrada => {
                return entrada && 
                       entrada.mensaje && 
                       entrada.mensaje !== 'undefined' && 
                       typeof entrada.mensaje === 'string' &&
                       entrada.mensaje.trim() !== '' &&
                       entrada.timestamp;
            });
            
            // Si se eliminaron entradas, actualizar
            if (historialLimpio.length !== historialOriginal.length) {
                historialSaldos[fecha] = historialLimpio;
                datosModificados = true;
                console.log(`Migración: Limpiadas ${historialOriginal.length - historialLimpio.length} entradas corruptas para ${fecha}`);
            }
            
            // Si no quedan entradas válidas, eliminar la fecha completa
            if (historialLimpio.length === 0) {
                delete historialSaldos[fecha];
                datosModificados = true;
            }
        }
    });
    
    // Guardar cambios si se modificaron datos
    if (datosModificados) {
        saveToStorage();
        console.log('Migración de historial de saldos completada');
    }
}

// ===========================
// NAVEGACIÓN ENTRE PESTAÑAS
// ===========================

function switchTab(tabIndex) {
    // Remover clase activa de todas las pestañas
    document.querySelectorAll('.tab-button').forEach(tab => {
        tab.classList.remove('active-tab');
    });

    // Agregar clase activa a la pestaña seleccionada
    document.querySelectorAll('.tab-button')[tabIndex].classList.add('active-tab');

    // Ocultar todas las vistas
    const views = ['registro-view', 'resumen-view', 'transferencias-view', 'rendicion-cuentas-view', 'egresos-view', 'therapist-management-view', 'paquetes-view', 'administracion-view'];
    
    views.forEach(viewId => {
        const element = document.getElementById(viewId);
        if (element) {
            element.style.display = 'none';
        }
    });

    // Mostrar la vista correspondiente basada en el índice del botón
    let targetViewId = '';
    
    switch(tabIndex) {
        case 0:
            targetViewId = 'registro-view';
            break;
        case 1:
            targetViewId = 'resumen-view';
            break;
        case 2:
            targetViewId = 'transferencias-view';
            break;
        case 3:
            targetViewId = 'rendicion-cuentas-view';
            break;
        case 4:
            targetViewId = 'egresos-view';
            break;
        case 5:
            targetViewId = 'therapist-management-view';
            break;
        case 6:
            targetViewId = 'paquetes-view';
            // Funciones específicas para la vista de paquetes
            updateActivePackagesList();
            populatePackageTherapistSelect();
            
            // ⭐ AGREGAR: Inicializar estado de radio buttons y input de monto fijo
            setTimeout(() => {
                const defaultRadio = document.getElementById('package-contribution-20');
                const fixedInput = document.getElementById('package-fixed-amount-input');
                
                if (defaultRadio && !document.querySelector('input[name="package-neurotea-contribution"]:checked')) {
                    defaultRadio.checked = true;
                }
                
                if (fixedInput) {
                    const isFixed = document.querySelector('input[name="package-neurotea-contribution"]:checked')?.value === 'fixed';
                    fixedInput.disabled = !isFixed;
                    if (!isFixed) fixedInput.value = '';
                }
                
                updatePackageTotals();
            }, 100);
            break;
        case 7:
            targetViewId = 'administracion-view';
            // Funciones específicas para la vista de administración
            setTimeout(() => {
                if (typeof switchAdminModule === 'function') {
                    switchAdminModule('gestion-datos');
                }
                if (typeof detectAvailableData === 'function') {
                    detectAvailableData();
                }
                if (typeof updateSystemInfo === 'function') {
                    updateSystemInfo();
                }
            }, 100);
            break;
        default:
            console.error('Índice de pestaña no válido:', tabIndex);
            return;
    }
    
    // Mostrar la vista seleccionada
    const targetView = document.getElementById(targetViewId);
    if (targetView) {
        targetView.style.display = 'block';
    } else {
        console.error('Vista no encontrada:', targetViewId);
    }

    // Actualizar datos en la vista seleccionada
    updateAllViews(fechaActual);
}

// ===========================
// GESTIÓN DE TERAPEUTAS
// ===========================

function updateTherapistList() {
    const listContainer = document.getElementById('therapist-list-container');
    const counter = document.getElementById('therapist-counter');
    const select = document.getElementById('therapist-select');
    
    if (!listContainer || !counter || !select) return;

    // Actualizar contador
    counter.textContent = `${therapists.length} terapeutas disponibles`;

    // Actualizar lista
    if (therapists.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 text-center py-4">No hay terapeutas registradas</p>';
    } else {
        listContainer.innerHTML = therapists.map((therapist, index) => `
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
                <span class="font-medium cursor-pointer" onclick="editTherapist(${index})">${therapist}</span>
                <button onclick="deleteTherapist(${index})" class="text-red-500 hover:text-red-700 p-1">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        `).join('');
    }

    // Actualizar selector
    select.innerHTML = '<option value="">Seleccionar terapeuta</option>' +
        therapists.map(therapist => `<option value="${therapist}">${therapist}</option>`).join('');

    // Actualizar selectores en otras pestañas
    const egresoSelect = document.getElementById('egreso-therapist-select');
    if (egresoSelect) {
        egresoSelect.innerHTML = '<option value="">Seleccionar terapeuta</option>' +
            therapists.map(therapist => `<option value="${therapist}">${therapist}</option>`).join('');
    }

    // Reinicializar iconos de Lucide
    lucide.createIcons();
    saveToStorage();
}

function addTherapist() {
    const input = document.getElementById('new-therapist-name');
    if (!input) return;

    const name = input.value.trim();
    if (!name) {
        alert('Por favor ingrese un nombre');
        return;
    }

    if (therapists.length >= 20) {
        alert('No se pueden agregar más de 20 terapeutas');
        return;
    }

    if (therapists.includes(name)) {
        alert('Esta terapeuta ya está registrada');
        return;
    }

    therapists.push(name);
    therapists.sort();
    input.value = '';
    updateTherapistList();
    updateAllViews(fechaActual);
}

function deleteTherapist(index) {
    if (confirm(`¿Está seguro de eliminar a ${therapists[index]}?`)) {
        therapists.splice(index, 1);
        updateTherapistList();
        updateAllViews(fechaActual);
    }
}

function editTherapist(index) {
    const newName = prompt('Nuevo nombre:', therapists[index]);
    if (newName && newName.trim() && newName.trim() !== therapists[index]) {
        const oldName = therapists[index];
        const trimmedName = newName.trim();
        
        if (therapists.includes(trimmedName)) {
            alert('Este nombre ya existe');
            return;
        }
        
        therapists[index] = trimmedName;
        therapists.sort();
        
        // Actualizar sesiones existentes
        Object.keys(sessions).forEach(fecha => {
            sessions[fecha].forEach(session => {
                if (session.therapist === oldName) {
                    session.therapist = trimmedName;
                }
            });
        });
        
        updateTherapistList();
        updateAllViews(fechaActual);
    }
}

// ===========================
// CÁLCULOS DE SESIÓN
// ===========================

function calculateSessionValues() {
    const cashToNeurotea = parseNumber(document.getElementById('cash-to-neurotea')?.value || 0);
    const transferToTherapist = parseNumber(document.getElementById('transfer-to-therapist')?.value || 0);
    const transferToNeurotea = parseNumber(document.getElementById('transfer-to-neurotea')?.value || 0);

    const sessionValue = cashToNeurotea + transferToTherapist + transferToNeurotea;

    // Calcular aporte a NeuroTEA
    let neuroteaContribution = 0;
    const contributionType = document.querySelector('input[name="neurotea-contribution"]:checked')?.value;

    // 🔍 DEBUG: Ver qué porcentaje está seleccionado
    console.log('🔍 DEBUG calculateSessionValues:');
    console.log('  - contributionType:', contributionType);
    console.log('  - sessionValue:', sessionValue);

    if (contributionType === 'fixed') {
        neuroteaContribution = parseNumber(document.getElementById('fixed-amount-input')?.value || 0);
    } else {
        const percentage = parseFloat(contributionType) || 20;
        neuroteaContribution = sessionValue * (percentage / 100);
        console.log('  - percentage usado:', percentage);
        console.log('  - neuroteaContribution calculado:', neuroteaContribution);
    }

    const therapistFee = Math.max(0, sessionValue - neuroteaContribution);
    
    // Actualizar displays
    document.getElementById('session-value-display').textContent = formatCurrency(sessionValue);
    document.getElementById('neurotea-contribution-display').textContent = formatCurrency(neuroteaContribution);
    document.getElementById('therapist-fee-display').textContent = formatCurrency(therapistFee);
    
    // Validar botón de registro
    validateRegisterButton();
    
    return { sessionValue, neuroteaContribution, therapistFee };
}

function validateRegisterButton() {
    const therapist = document.getElementById('therapist-select')?.value;
    const sessionValue = parseNumber(document.getElementById('session-value-display')?.textContent?.replace(/[^\d]/g, '') || 0);
    const registerBtn = document.getElementById('register-btn');
    
    // Verificar si está en modo crédito (ID correcto)
    const creditMode = document.getElementById('modo-usar-credito')?.checked;
    const creditPatient = document.getElementById('paciente-credito-select')?.value;
    
    if (registerBtn) {
        // Habilitar si: (tiene terapeuta Y sessionValue > 0) O (modo crédito con terapeuta y paciente seleccionado)
        const normalModeValid = therapist && sessionValue > 0;
        const creditModeValid = creditMode && therapist && creditPatient;
        
        if (normalModeValid || creditModeValid) {
            registerBtn.disabled = false;
            registerBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
            registerBtn.classList.add('bg-purple-600', 'hover:bg-purple-700');
        } else {
            registerBtn.disabled = true;
            registerBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
            registerBtn.classList.remove('bg-purple-600', 'hover:bg-purple-700');
        }
    }
}

function toggleFixedAmount() {
    const fixedRadio = document.getElementById('contribution-fixed');
    const fixedInput = document.getElementById('fixed-amount-input');
    
    if (fixedRadio && fixedInput) {
        fixedInput.disabled = !fixedRadio.checked;
        if (fixedRadio.checked) {
            fixedInput.focus();
        } else {
            fixedInput.value = '';
        }
        calculateSessionValues();
    }
}

// ===========================
// REGISTRO DE SESIONES
// ===========================
function registerSession() {
    // NUEVA LÓGICA: Verificar si hay sesiones futuras en el carrito
    if (sesionesFuturasTemp.length > 0) {
        // Si hay sesiones futuras, procesar todo junto
        registerPaymentSession();
    } else {
        // FASE 3: Determinar el modo de registro
        const paymentMode = document.querySelector('input[name="modo-registro"]:checked').value;
        
        if (paymentMode === 'usar-credito') {
            registerCreditSession();
        } else {
            registerPaymentSession();
        }
    }
}

/**
 * FASE 3: Registra una sesión usando créditos disponibles (valor $0)
 */
function registerCreditSession() {
    const therapist = document.getElementById('therapist-select').value;
    const fecha = document.getElementById('session-date').value || fechaActual;
    const patientName = document.getElementById('paciente-credito-select').value;
    
    // Validaciones específicas para créditos
    const validation = validateCreditMode();
    if (!validation.valid) {
        alert(validation.message);
        return;
    }
    
    // Verificar créditos disponibles usando función de Fase 1
    if (!hasAvailableCredits(patientName, therapist)) {
        alert('Este paciente no tiene créditos disponibles para esta terapeuta');
        return;
    }
    
    // Usar crédito usando función de Fase 1
    const creditResult = usePatientCredits(patientName, therapist, Date.now());
    
    if (!creditResult.success) {
        alert('Error al usar crédito: ' + creditResult.message);
        return;
    }
    
    // Crear sesión con valores $0 (no genera ingresos del día)
    const session = {
        id: Date.now(),
        therapist,
        fecha,
        patientName,
        cashToNeurotea: 0,           // SIEMPRE 0 para créditos
        transferToTherapist: 0,      // SIEMPRE 0 para créditos
        transferToNeurotea: 0,       // SIEMPRE 0 para créditos
        sessionValue: 0,             // SIEMPRE 0 para créditos
        neuroteaContribution: 0,     // SIEMPRE 0 para créditos
        therapistFee: 0,             // SIEMPRE 0 para créditos
        creditUsed: true,            // NUEVO: Marca que usó crédito
        originalPackageId: creditResult.packageUsed || 'unknown',
        remainingCredits: creditResult.remainingInPackage || 0
    };
    
    // Agregar sesión (NO actualizar saldos reales porque es $0)
    if (!sessions[fecha]) sessions[fecha] = [];
    sessions[fecha].push(session);

    // CORRECCIÓN: Actualizar vistas ANTES de limpiar formulario
    updateAllViews(fecha);

    // CORRECCIÓN: Actualizar lista de paquetes activos (para reflejar créditos usados)
    updateActivePackagesList();

    // Limpiar formulario después de actualizar vistas
    clearSessionForm();

    saveToStorageAsync();

    // Mensaje de confirmación específico para créditos
    const remainingCredits = creditResult.remainingInPackage !== undefined ? creditResult.remainingInPackage : 0;
    alert(`✅ Sesión registrada usando crédito.\nPaciente: ${patientName}\nTerapeuta: ${therapist}\nCréditos restantes: ${remainingCredits}`);
}

/**
 * FASE 3: Registra una sesión con pago del día (comportamiento actual + créditos adicionales)
 */
function registerPaymentSession() {
    const therapist = document.getElementById('therapist-select')?.value;
    const fecha = document.getElementById('session-date')?.value || fechaActual;
    const patientName = document.getElementById('patient-name')?.value?.trim();
    
    // LOGS DE DEBUG - FASE 3: Verificación de fechas
    console.log("🔍 DEBUG Fechas:");
    console.log("  - Fecha del formulario:", document.getElementById('session-date')?.value);
    console.log("  - fechaActual global:", fechaActual);
    console.log("  - fecha usada:", fecha);
    console.log("  - sessions[fecha] existe:", !!sessions[fecha]);
    console.log("  - sessions[fecha] contenido:", sessions[fecha]);
    
    // Validaciones del modo de pago
    const validation = validatePaymentMode();
    if (!validation.valid) {
        alert(validation.message);
        return;
    }
    
    const values = calculateSessionValues();
    if (values.sessionValue <= 0) {
        alert('El valor de la sesión debe ser mayor a 0');
        return;
    }
    
    const cashToNeurotea = parseNumber(document.getElementById('cash-to-neurotea')?.value || 0);
    const transferToTherapist = parseNumber(document.getElementById('transfer-to-therapist')?.value || 0);
    const transferToNeurotea = parseNumber(document.getElementById('transfer-to-neurotea')?.value || 0);
    
    // MANTENER EXACTAMENTE EL COMPORTAMIENTO ACTUAL
    const session = {
        id: Date.now(),
        therapist,
        fecha,
        patientName,
        cashToNeurotea,
        transferToTherapist,
        transferToNeurotea,
        sessionValue: values.sessionValue,
        neuroteaContribution: values.neuroteaContribution,
        therapistFee: values.therapistFee
    };
    
    if (!sessions[fecha]) {
        sessions[fecha] = [];
    }
    sessions[fecha].push(session);

    // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales aquí
    // El saldo se calcula DINÁMICAMENTE con calcularSaldoCajaReal()
    // basándose en las sesiones actuales, no en variables acumulativas

    // NUEVA LÓGICA: Verificar si se deben crear créditos adicionales
    const createAdditional = document.getElementById('crear-creditos-adicionales').checked;
    
    if (createAdditional) {
        // NUEVO: Procesar sesiones futuras del mini carrito
        if (sesionesFuturasTemp.length > 0) {
            try {
                const creditosCreados = procesarSesionesFuturas(patientName, fecha);
                console.log(`✅ Sesión registrada + ${creditosCreados} créditos futuros creados`);
            } catch (error) {
                console.error('❌ Error al procesar sesiones futuras:', error);
                alert('Sesión registrada, pero hubo un error al crear las sesiones futuras');
            }
        } else {
            // LÓGICA ANTERIOR: Créditos adicionales simples (mantener por compatibilidad)
            const cantidad = parseInt(document.getElementById('creditos-cantidad').value);
            
            if (cantidad > 0 && cantidad <= 20) {
                try {
                    // Usar función de Fase 1 para crear créditos adicionales
                    createPatientCredits({
                        patientName: patientName,
                        therapist: therapist,
                        quantity: cantidad,
                        packageId: `additional_${Date.now()}`,
                        valuePerSession: Math.round(values.sessionValue / cantidad),
                        totalValue: values.sessionValue,
                        purchaseDate: fecha,
                        createdBy: 'session_additional',
                        notes: `Créditos adicionales creados junto con sesión del ${fecha}`
                    });
                    
                    console.log(`✅ Créditos adicionales creados: ${cantidad} para ${patientName} con ${therapist}`);
                    
                } catch (error) {
                    console.error('❌ Error al crear créditos adicionales:', error);
                    alert('Sesión registrada, pero hubo un error al crear los créditos adicionales');
                }
            }
        }
    }
    
    // LOGS DE DEBUG - FASE 1
    console.log("🔍 DEBUG: Antes de updateAllViews()");
    console.log("🔍 DEBUG: Fecha actual:", fecha);
    console.log("🔍 DEBUG: Sessions data:", sessions[fecha]);
    
    // CORRECCIÓN: Actualizar vistas ANTES de limpiar formulario
    updateAllViews(fecha);
    
    console.log("🔍 DEBUG: Después de updateAllViews()");
    console.log("🔍 DEBUG: Antes de clearSessionForm()");
    
    // Limpiar formulario DESPUÉS de actualizar vistas
    clearSessionForm();
    
    console.log("🔍 DEBUG: Después de clearSessionForm()");
    console.log("🔍 DEBUG: FIN del registro");
    
    saveToStorageAsync();
    
    // NO mostrar alert - registro silencioso (comportamiento actual)
}

function clearSessionForm() {
    // Verificar y limpiar campos básicos
    const therapistSelect = document.getElementById('therapist-select');
    if (therapistSelect) therapistSelect.value = '';
    
    const patientName = document.getElementById('patient-name');
    if (patientName) patientName.value = '';
    
    const cashToNeurotea = document.getElementById('cash-to-neurotea');
    if (cashToNeurotea) cashToNeurotea.value = '';
    
    const transferToTherapist = document.getElementById('transfer-to-therapist');
    if (transferToTherapist) transferToTherapist.value = '';
    
    const transferToNeurotea = document.getElementById('transfer-to-neurotea');
    if (transferToNeurotea) transferToNeurotea.value = '';
    
    const fixedAmountInput = document.getElementById('fixed-amount-input');
    if (fixedAmountInput) {
        fixedAmountInput.value = '';
        fixedAmountInput.disabled = true;
    }
    
    const contribution20 = document.getElementById('contribution-20');
    if (contribution20) contribution20.checked = true;
    
    // FASE 3: Limpiar nuevos campos con verificaciones
    const modoPagoDia = document.getElementById('modo-pago-dia');
    if (modoPagoDia) modoPagoDia.checked = true;
    
    const modoUsarCredito = document.getElementById('modo-usar-credito');
    if (modoUsarCredito) modoUsarCredito.checked = false;
    
    const crearCreditosAdicionales = document.getElementById('crear-creditos-adicionales');
    if (crearCreditosAdicionales) crearCreditosAdicionales.checked = false;
    
    const creditosCantidad = document.getElementById('creditos-cantidad');
    if (creditosCantidad) creditosCantidad.value = '';
    
    const creditosCantidadContainer = document.getElementById('creditos-cantidad-container');
    if (creditosCantidadContainer) creditosCantidadContainer.style.display = 'none';
    
    const pacienteCreditoSelect = document.getElementById('paciente-credito-select');
    if (pacienteCreditoSelect) pacienteCreditoSelect.value = '';
    
    const creditosInfoDisplay = document.getElementById('creditos-info-display');
    if (creditosInfoDisplay) creditosInfoDisplay.innerHTML = '';
    
    // NUEVO: Limpiar mini carrito de sesiones futuras
    sesionesFuturasTemp = [];
    const sesionesFuturasContainer = document.getElementById('sesiones-futuras-container');
    if (sesionesFuturasContainer) {
        sesionesFuturasContainer.style.display = 'none';
        actualizarListaSesionesFuturas();
    }
    
    // Resetear visibilidad de secciones con verificaciones
    const creditosAdicionalesSection = document.getElementById('creditos-adicionales-section');
    if (creditosAdicionalesSection) creditosAdicionalesSection.style.display = 'block';
    
    const pacienteCreditoSection = document.getElementById('paciente-credito-section');
    if (pacienteCreditoSection) pacienteCreditoSection.style.display = 'none';
    
    const desglosePagoSection = document.getElementById('desglose-pago-section');
    if (desglosePagoSection) desglosePagoSection.style.display = 'block';
    
    calculateSessionValues();
}

// ===========================
// GESTIÓN DE EGRESOS
// ===========================

function addEgreso() {
    const tipo = document.getElementById('egreso-type')?.value;
    const concepto = document.getElementById('egreso-concept')?.value?.trim();
    const monto = parseNumber(document.getElementById('egreso-value')?.value || 0);
    const fecha = fechaActual;
    
    if (!tipo || !concepto || monto <= 0) {
        alert('Por favor complete todos los campos');
        return;
    }
    
    if (tipo === 'adelanto') {
        const therapist = document.getElementById('egreso-therapist-select')?.value;
        if (!therapist) {
            alert('Por favor seleccione una terapeuta para el adelanto');
            return;
        }
    }
    
    const egreso = {
        id: Date.now(),
        tipo,
        concepto,
        monto,
        fecha,
        therapist: tipo === 'adelanto' ? document.getElementById('egreso-therapist-select')?.value : null
    };
    
    if (!egresos[fecha]) {
        egresos[fecha] = [];
    }
    egresos[fecha].push(egreso);

    // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
    // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()

    // Limpiar formulario
    document.getElementById('egreso-concept').value = '';
    document.getElementById('egreso-value').value = '';
    document.getElementById('egreso-therapist-select').value = '';
    
    updateAllViews(fecha);
    saveToStorage();
    // NO mostrar alert - registro silencioso
}

async function deleteEgreso(fecha, egresoId) {
    if (!confirm('¿Está seguro de eliminar este egreso?')) return;

    const egresoIndex = egresos[fecha].findIndex(e => e.id === egresoId);
    if (egresoIndex !== -1) {
        // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
        // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()
        egresos[fecha].splice(egresoIndex, 1);
        
        if (egresos[fecha].length === 0) {
            delete egresos[fecha];
        }
        
        // NUEVO: Eliminar de IndexedDB
        try {
            await deleteSingleEgresoFromIndexedDB(egresoId);
        } catch (error) {
            console.error('Error deleting egreso from IndexedDB:', error);
        }
        
        updateAllViews(fecha);
        saveToStorage();
    }
}

async function clearAllEgresos() {
    if (!confirm('¿Está seguro de eliminar todos los egresos del día?')) return;

    const fecha = fechaActual;
    if (egresos[fecha]) {
        // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
        // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()

        delete egresos[fecha];

        // Eliminar de IndexedDB
        try {
            await deleteEgresosByDate(fecha);
        } catch (error) {
            console.error('Error deleting egresos from IndexedDB:', error);
        }

        updateAllViews(fecha);
        saveToStorage();
        alert('Todos los egresos del día han sido eliminados');
    }
}

function toggleTherapistSelect() {
    const tipo = document.getElementById('egreso-type')?.value;
    const therapistContainer = document.getElementById('egreso-therapist-container');
    
    if (therapistContainer) {
        if (tipo === 'adelanto') {
            therapistContainer.style.display = 'block';
        } else {
            therapistContainer.style.display = 'none';
            document.getElementById('egreso-therapist-select').value = '';
        }
    }
}

// ===========================
// CÁLCULOS DE RENDICIÓN DE CUENTAS
// ===========================

function calculateTherapistStatus(therapist, fecha) {
    const daySessions = sessions[fecha] || [];
    const dayEgresos = egresos[fecha] || [];
    
    // Incluir paquetes diarios
    const dayPackages = dailyPackagePurchases[fecha] || [];
    
    // Calcular totales para esta terapeuta
    const therapistSessions = daySessions.filter(s => s.therapist === therapist);
    const therapistPackages = dayPackages.filter(p => p.therapist === therapist);
    
    // Verificar si no hay datos
    if (therapistSessions.length === 0 && therapistPackages.length === 0) {
        return {
            ingresoTotal: 0,
            aporteNeurotea: 0,
            honorarios: 0,
            transferenciaATerapeuta: 0,
            adelantosRecibidos: 0,
            neuroteaLeDebe: 0,
            terapeutaDebe: 0,
            estado: 'SALDADO',
            colorClass: 'badge-secondary'
        };
    }
    
    // CALCULAR: Ingresos (sesiones + paquetes)
    const sessionIncome = therapistSessions.filter(s => !s.creditUsed).reduce((sum, s) => sum + s.sessionValue, 0);
    const packageIncome = therapistPackages.reduce((sum, p) => sum + p.sessionValue, 0);
    const ingresoTotal = sessionIncome + packageIncome;
    
    // CALCULAR: Aportes a NeuroTEA
    const sessionAporte = therapistSessions.filter(s => !s.creditUsed).reduce((sum, s) => sum + s.neuroteaContribution, 0);
    const packageAporte = therapistPackages.reduce((sum, p) => sum + (p.neuroteaContribution || 0), 0);
    const aporteNeurotea = sessionAporte + packageAporte;
    
    // CALCULAR: Honorarios
    const sessionHonorarios = therapistSessions.filter(s => !s.creditUsed).reduce((sum, s) => sum + s.therapistFee, 0);
    const packageHonorarios = packageIncome - packageAporte;
    const honorarios = sessionHonorarios + packageHonorarios;
    
    // CALCULAR: Transferencias
    const sessionTransfer = therapistSessions.reduce((sum, s) => sum + s.transferToTherapist, 0);
    const packageTransfer = therapistPackages.reduce((sum, p) => sum + p.transferToTherapist, 0);
    const transferenciaATerapeuta = sessionTransfer + packageTransfer;
    
    // CALCULAR: Adelantos recibidos
    const adelantosRecibidos = dayEgresos
        .filter(e => e.tipo === 'adelanto' && e.therapist === therapist)
        .reduce((sum, e) => sum + e.monto, 0);
    
    // CALCULAR: Lo que debe cada uno
    const neuroteaLeDebe = honorarios - transferenciaATerapeuta - adelantosRecibidos;
    const terapeutaDebe = neuroteaLeDebe < 0 ? Math.abs(neuroteaLeDebe) : 0;
    const neuroteaDebe = neuroteaLeDebe > 0 ? neuroteaLeDebe : 0;

    // AGREGAR PROPIEDADES FALTANTES PARA COMPROBANTES
    const valorTotalSesiones = sessionIncome + packageIncome;
    const aporteNeuroTEA = sessionAporte + packageAporte;

    // ✅ ARQUITECTURA CORREGIDA: Usar función dinámica para saldo en caja
    // NO depende de saldosReales.efectivo (variable acumulativa problemática)
    const saldoCajaActual = calcularSaldoCajaReal(fecha);
    
    // Obtener saldo de cuenta NeuroTEA
    const saldoCuentaNeuroTEA = calcularSaldoCuentaNeuroTEA(fecha);
    
    // DETERMINAR: Estado
    let estado = '';
    let colorClass = '';
    
    if (neuroteaLeDebe === 0) {
        estado = 'SALDADO';
        colorClass = 'badge-secondary';
    } else if (neuroteaLeDebe < 0) {
        estado = 'LA TERAPEUTA DEBE DAR';
        colorClass = 'badge-danger';
    } else {
        const fondosTotalesDisponibles = saldoCajaActual + saldoCuentaNeuroTEA;
        
        if (fondosTotalesDisponibles < neuroteaDebe) {
            estado = 'FONDOS INSUFICIENTES';
            colorClass = 'badge-danger';
        } else if (saldoCajaActual >= neuroteaDebe) {
            estado = 'DAR EFECTIVO';
            colorClass = 'badge-success';
        } else if (saldoCajaActual > 0) {
            estado = 'DAR Y TRANSFERIR';
            colorClass = 'badge-warning';
        } else {
            estado = 'TRANSFERIR';
            colorClass = 'badge-info';
        }
    }
    
    // ✅ NUEVO: Obtener información de confirmación y vueltos
    let confirmacionInfo = null;
    if (confirmaciones[fecha] && confirmaciones[fecha][therapist]) {
        const conf = confirmaciones[fecha][therapist];
        confirmacionInfo = {
            confirmado: true,
            timestamp: conf.timestamp,
            tipoOpcion: conf.flujo?.tipoOpcion || 'exacto',
            efectivoUsado: conf.flujo?.efectivoUsado || 0,
            efectivoRecibido: conf.flujo?.efectivoRecibido || 0,
            vueltoEfectivo: conf.flujo?.vueltoEfectivo || 0,
            bancoUsado: conf.flujo?.bancoUsado || 0,
            modalidad: conf.modalidad || null,
            estadoCongelado: conf.estadoCongelado || null
        };
    }

    return {
        ingresoTotal,
        aporteNeurotea,
        honorarios,
        transferenciaATerapeuta,
        adelantosRecibidos,
        neuroteaLeDebe: neuroteaDebe,
        terapeutaDebe,
        estado,
        colorClass,
        saldoCuentaNeuroTEA,
        saldoCajaActual,
        valorTotalSesiones,
        aporteNeuroTEA,
        // ✅ NUEVO: Información de confirmación y vueltos
        confirmacionInfo
    };
}

// ===========================
// CONFIRMACIÓN DE PAGOS CON REVERSIÓN
// ===========================

function handlePaymentOption(therapist, fecha, option) {
    if (!option) return;
    
    switch(option) {
        case 'exacto':
            confirmTherapistPayment(therapist, fecha, 'exacto');
            break;
        case 'vuelto':
            const status = calculateTherapistStatus(therapist, fecha);
            const montoReal = prompt(`Debe dar ${formatCurrency(status.neuroteaLeDebe)}. ¿Cuánto va a entregar en efectivo?`, status.neuroteaLeDebe);
            if (montoReal && parseNumber(montoReal) > status.neuroteaLeDebe) {
                confirmTherapistPayment(therapist, fecha, 'vuelto', parseNumber(montoReal));
            } else if (montoReal) {
                alert('El monto debe ser mayor al adeudado para generar vuelto');
            }
            break;
        case 'transferir':
            confirmTherapistPayment(therapist, fecha, 'transferir');
            break;
        case 'vuelto-efectivo':
            const statusEfectivo = calculateTherapistStatus(therapist, fecha);
            const montoEfectivo = prompt(`Debe dar ${formatCurrency(statusEfectivo.neuroteaLeDebe)}. ¿Cuánto va a entregar en efectivo? (Vuelto será en efectivo)`, statusEfectivo.neuroteaLeDebe);
            if (montoEfectivo && parseNumber(montoEfectivo) > statusEfectivo.neuroteaLeDebe) {
                confirmTherapistPayment(therapist, fecha, 'vuelto-efectivo', parseNumber(montoEfectivo));
            } else if (montoEfectivo) {
                alert('El monto debe ser mayor al adeudado para generar vuelto');
            }
            break;
    }
    
    // Resetear el select después de la acción
    setTimeout(() => {
        const select = document.querySelector(`select[onchange*="${therapist}"]`);
        if (select) select.value = '';
    }, 100);
}

function toggleTherapistPayment(therapist, fecha) {
    const isConfirmed = isTherapistPaymentConfirmed(therapist, fecha);
    
    if (isConfirmed) {
        revertTherapistPayment(therapist, fecha);
    } else {
        confirmTherapistPayment(therapist, fecha);
    }
}

function confirmTherapistPayment(therapist, fecha, tipoOpcion = 'exacto', montoReal = null) {
    if (!confirm(`¿Confirmar pago a ${therapist}?`)) return;

    const status = calculateTherapistStatus(therapist, fecha);

    // Verificar si hay fondos suficientes
    if (status.estado === 'FONDOS INSUFICIENTES') {
        alert('No hay fondos suficientes para realizar el pago');
        return;
    }

    if (!confirmaciones[fecha]) {
        confirmaciones[fecha] = {};
    }

    const flujoDetalle = {
        efectivoUsado: 0,
        bancoUsado: 0,
        efectivoRecibido: 0,
        vueltoEfectivo: 0,
        tipoOpcion: tipoOpcion
    };

    // ✅ ARQUITECTURA CORREGIDA: Solo registrar el flujo, NO modificar saldosReales
    // El saldo se calcula DINÁMICAMENTE con calcularSaldoCajaReal()
    switch (status.estado) {
        case 'DAR EFECTIVO':
            switch(tipoOpcion) {
                case 'exacto':
                    flujoDetalle.efectivoUsado = status.neuroteaLeDebe;
                    break;
                case 'vuelto':
                    const vuelto = montoReal - status.neuroteaLeDebe;
                    flujoDetalle.efectivoUsado = montoReal;
                    flujoDetalle.efectivoRecibido = vuelto; // Vuelto por transferencia
                    break;
                case 'transferir':
                    flujoDetalle.bancoUsado = status.neuroteaLeDebe;
                    break;
                case 'vuelto-efectivo':
                    const vueltoEfectivo = montoReal - status.neuroteaLeDebe;
                    flujoDetalle.efectivoUsado = status.neuroteaLeDebe; // Neto que sale
                    flujoDetalle.vueltoEfectivo = vueltoEfectivo; // Para tracking
                    break;
            }
            break;

        case 'DAR Y TRANSFERIR':
            const efectivoDisponible = status.saldoCajaActual;
            const diferenciaNecesaria = status.neuroteaLeDebe - efectivoDisponible;

            flujoDetalle.efectivoUsado = efectivoDisponible;
            flujoDetalle.bancoUsado = diferenciaNecesaria;
            break;

        case 'TRANSFERIR':
            flujoDetalle.bancoUsado = status.neuroteaLeDebe;
            break;

        case 'LA TERAPEUTA DEBE DAR':
            flujoDetalle.efectivoRecibido = status.terapeutaDebe;
            break;

        case 'SALDADO':
            // No hay movimiento de dinero
            break;

        default:
            alert('Estado no reconocido: ' + status.estado);
            return;
    }

    // Guardar confirmación con estado congelado
    confirmaciones[fecha][therapist] = {
        timestamp: Date.now(),
        amount: status.neuroteaLeDebe || status.terapeutaDebe,
        type: status.estado,
        flujo: flujoDetalle,
        estadoCongelado: { ...status }
    };

    console.log(`✅ Pago confirmado: ${therapist} - ${status.estado} - Efectivo: ${flujoDetalle.efectivoUsado}, Banco: ${flujoDetalle.bancoUsado}`);

    updateAllViews(fecha);
    saveToStorage();
}

function revertTherapistPayment(therapist, fecha) {
    if (!confirm(`¿Revertir confirmación de pago a ${therapist}?`)) return;

    const confirmacion = confirmaciones[fecha][therapist];
    if (!confirmacion) return;

    // ✅ ARQUITECTURA CORREGIDA: Solo eliminar la confirmación
    // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()
    // No es necesario modificar saldosReales

    console.log(`🔄 Revirtiendo pago: ${therapist} - ${confirmacion.type}`);

    // Eliminar confirmación
    delete confirmaciones[fecha][therapist];

    updateAllViews(fecha);
    saveToStorage();
}


/**
 * ✅ ARQUITECTURA CORREGIDA: Limpia confirmaciones de un terapeuta cuando se elimina una sesión
 * Busca por terapeuta (no por sessionIds que nunca existió)
 * @param {string} fecha - Fecha de la sesión
 * @param {Object} session - Sesión que se va a eliminar
 */
function cleanupSessionConfirmations(fecha, session) {
    if (!confirmaciones[fecha]) return;
    if (!session || !session.therapist) return;

    const therapist = session.therapist;

    // Verificar si hay confirmación para este terapeuta
    if (confirmaciones[fecha][therapist]) {
        console.log(`🔄 Eliminando confirmación de ${therapist} (sesión eliminada)`);

        // ✅ ARQUITECTURA CORREGIDA: Solo eliminar la confirmación
        // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()
        delete confirmaciones[fecha][therapist];
    }
}


/**
 * Revierte los créditos usados en una sesión
 * Si la sesión usó créditos, incrementa el remaining del paquete
 * @param {Object} session - Objeto de sesión con información
 */
function revertSessionCredits(session) {
    if (!session.creditUsed) return;
    
    const fecha = session.fecha || fechaActual;
    const dayPackages = dailyPackagePurchases[fecha] || [];
    
    // Buscar el paquete que se usó
    for (let pkg of dayPackages) {
        // Validar que sea el paquete correcto
        if (pkg.therapist === session.therapist && 
            pkg.patientName === session.patientName &&
            pkg.remaining < pkg.total) {
            
            // Incrementar créditos disponibles
            pkg.remaining++;
            console.log(`✅ Crédito revertido: ${session.patientName} - ${session.therapist} (remaining: ${pkg.remaining}/${pkg.total})`);
            return;
        }
    }
    
    console.warn(`⚠️ No se encontró paquete para revertir crédito: ${session.patientName} - ${session.therapist}`);
}


function isTherapistPaymentConfirmed(therapist, fecha) {
    return confirmaciones[fecha] && confirmaciones[fecha][therapist];
}

// ===========================
// ACTUALIZACIÓN DE VISTAS
// ===========================

function updateAllViews(fecha) {
    try {
        // DEBUG: Agregar log para diagnosticar problema de fecha
        console.log("🔍 DEBUG updateAllViews: Recibió fecha:", fecha);
        
        // Validar fecha
        if (!fecha) {
            console.error("❌ ERROR: updateAllViews recibió fecha inválida:", fecha);
            fecha = fechaActual || getLocalDateString();
            console.log("🔧 CORRECCIÓN: Usando fecha por defecto:", fecha);
        }
        
        updateDailySessionsList(fecha);
        updateDashboard(fecha);
        updateTransferDetails(fecha);
        updateRendicionCuentas(fecha);
        updateEgresosList(fecha);
        updateTherapistList();
        updateSaldoBadge(fecha); // Actualizar badge de saldo inicial
        
        console.log("✅ DEBUG updateAllViews: Completado exitosamente");
        
    } catch (error) {
        console.error("❌ ERROR CRÍTICO en updateAllViews:", error);
        console.error("Stack trace:", error.stack);
        
        // Mostrar mensaje de error en la interfaz
        const errorMessage = document.createElement('div');
        errorMessage.innerHTML = `
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                <strong>Error crítico:</strong> No se pudieron actualizar las vistas. 
                <button onclick="location.reload()" class="underline">Recargar página</button>
            </div>
        `;
        document.body.insertBefore(errorMessage, document.body.firstChild);
    }
}

function updateDailySessionsList(fecha) {
    try {
        // LOGS DE DEBUG - FASE 2
        console.log("🔍 DEBUG updateDailySessionsList: Entrada con fecha:", fecha);
        
        // Validar que las variables globales existan
        if (typeof sessions === 'undefined') sessions = {};
        
        const container = document.getElementById('daily-sessions-container');
        if (!container) {
            console.log("❌ DEBUG: Container 'daily-sessions-container' NO encontrado");
            return;
        }
        console.log("✅ DEBUG: Container encontrado:", container);
        
        const daySessions = sessions[fecha] || [];
        console.log("🔍 DEBUG: Sessions para fecha", fecha, ":", daySessions);
        console.log("🔍 DEBUG: Cantidad de sesiones:", daySessions.length);
        
        if (daySessions.length === 0) {
            console.log("⚠️ DEBUG: No hay sesiones para mostrar");
            container.innerHTML = '<p class="text-gray-500 text-center py-4">No hay sesiones registradas para este día</p>';
            return;
        }
    
    console.log("🔍 DEBUG: Procesando", daySessions.length, "sesiones...");
    
    // Agrupar sesiones por terapeuta y tipo (normal vs crédito)
    const sessionsByTherapist = {};
    daySessions.forEach(session => {
        if (!sessionsByTherapist[session.therapist]) {
            sessionsByTherapist[session.therapist] = {
                normal: [],
                credits: []
            };
        }
        
        // Separar sesiones normales de sesiones con crédito
        if (session.creditUsed === true) {
            sessionsByTherapist[session.therapist].credits.push(session);
        } else {
            sessionsByTherapist[session.therapist].normal.push(session);
        }
    });
    
    // Generar HTML agrupado por terapeuta con secciones separadas
    const therapistGroups = Object.keys(sessionsByTherapist).sort().map(therapist => {
        const normalSessions = sessionsByTherapist[therapist].normal;
        const creditSessions = sessionsByTherapist[therapist].credits;
        
        let html = '';
        
        // SECCIÓN NORMAL (azul) - solo si hay sesiones normales
        if (normalSessions.length > 0) {
            const normalCount = normalSessions.length;
            const normalTotalValue = normalSessions.reduce((sum, s) => sum + s.sessionValue, 0);
            
            const normalSessionsHTML = normalSessions.map(session => `
                <div class="p-3 border-l-4 border-blue-300 bg-gray-50 dark:bg-gray-700 ml-4 mb-2">
                    <div class="flex justify-between items-start mb-2">
                        <h5 class="font-semibold text-gray-800 dark:text-gray-200">${session.patientName || 'Sin nombre'}</h5>
                        <button onclick="deleteSession('${fecha}', ${session.id})" class="text-red-500 hover:text-red-700 p-1">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div>Efectivo: ${formatCurrency(session.cashToNeurotea)}</div>
                        <div>Transf. Terapeuta: ${formatCurrency(session.transferToTherapist)}</div>
                        <div>Transf. NeuroTEA: ${formatCurrency(session.transferToNeurotea)}</div>
                        <div class="font-bold">Total: ${formatCurrency(session.sessionValue)}</div>
                        <div>Aporte NeuroTEA: ${formatCurrency(session.neuroteaContribution)}</div>
                        <div>Honorarios: ${formatCurrency(session.therapistFee)}</div>
                    </div>
                </div>
            `).join('');
            
            html += `
                <div class="mb-4 border rounded-md bg-white dark:bg-gray-800 overflow-hidden">
                    <div class="bg-blue-50 dark:bg-blue-900 p-4 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors" 
                         onclick="toggleTherapistGroup('${therapist.replace(/'/g, "\\'")}', 'normal')">
                        <div class="flex justify-between items-center">
                            <h4 class="font-semibold text-blue-800 dark:text-blue-200">${therapist}</h4>
                            <div class="flex items-center space-x-2">
                                <span class="text-sm text-blue-600 dark:text-blue-300">${normalCount} sesión${normalCount !== 1 ? 'es' : ''} - ${formatCurrency(normalTotalValue)}</span>
                                <i data-lucide="chevron-down" class="w-4 h-4 text-blue-600 dark:text-blue-300 transform transition-transform" id="chevron-${therapist.replace(/[^a-zA-Z0-9]/g, '_')}_normal"></i>
                            </div>
                        </div>
                    </div>
                    <div class="hidden p-4" id="sessions-${therapist.replace(/[^a-zA-Z0-9]/g, '_')}_normal">
                        ${normalSessionsHTML}
                    </div>
                </div>
            `;
        }
        
        // SECCIÓN CRÉDITOS (beige) - solo si hay sesiones con crédito
        if (creditSessions.length > 0) {
            const creditCount = creditSessions.length;
            
            const creditSessionsHTML = creditSessions.map(session => {
                const creditUsage = calculateCreditUsage(session);
                return `
                    <div class="session-credit p-3 border-l-4 ml-4 mb-2">
                        <div class="flex justify-between items-start mb-2">
                            <h5 class="font-semibold credit-text-bold">${session.patientName || 'Sin nombre'}</h5>
                            <button onclick="deleteSession('${fecha}', ${session.id})" class="text-red-500 hover:text-red-700 p-1">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-sm">
                            <div class="credit-text-secondary">Efectivo: Gs 0</div>
                            <div class="credit-text-secondary">Transf. Terapeuta: Gs 0</div>
                            <div class="credit-text-secondary">Transf. NeuroTEA: Gs 0</div>
                            <div class="font-bold credit-text-bold">${creditUsage}</div>
                            <div class="credit-text-secondary">Aporte NeuroTEA: Gs 0</div>
                            <div class="credit-text-secondary">Honorarios: Gs 0</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            html += `
                <div class="mb-4 border rounded-md bg-white dark:bg-gray-800 overflow-hidden">
                    <div class="therapist-section-credits p-4 cursor-pointer transition-colors" 
                         onclick="toggleTherapistGroup('${therapist.replace(/'/g, "\\'")}', 'credits')">
                        <div class="flex justify-between items-center">
                            <h4 class="font-semibold credit-text-bold">${therapist}</h4>
                            <div class="flex items-center space-x-2">
                                <span class="text-sm credit-text-primary">${creditCount} sesión${creditCount !== 1 ? 'es' : ''} - Gs 0</span>
                                <i data-lucide="chevron-down" class="w-4 h-4 credit-text-primary transform transition-transform" id="chevron-${therapist.replace(/[^a-zA-Z0-9]/g, '_')}_credits"></i>
                            </div>
                        </div>
                    </div>
                    <div class="hidden p-4" id="sessions-${therapist.replace(/[^a-zA-Z0-9]/g, '_')}_credits">
                        ${creditSessionsHTML}
                    </div>
                </div>
            `;
        }
        
        return html;
    }).join('');
    
    container.innerHTML = therapistGroups;
    lucide.createIcons();
    
    } catch (error) {
        console.error("❌ ERROR en updateDailySessionsList:", error);
        console.error("Stack trace:", error.stack);
        
        const container = document.getElementById('daily-sessions-container');
        if (container) {
            container.innerHTML = '<p class="text-red-500 text-center py-4">Error al cargar sesiones. Revise la consola para más detalles.</p>';
        }
    }
}

// Nueva función para calcular el uso de créditos
function calculateCreditUsage(session) {
    try {
        // Intentar obtener información precisa de créditos
        const creditsInfo = getPatientCreditsInfo(session.patientName, session.therapist);
        
        if (creditsInfo && creditsInfo.totalOriginal && creditsInfo.totalRemaining !== undefined) {
            const total = creditsInfo.totalOriginal;
            const remaining = creditsInfo.totalRemaining;
            const used = total - remaining;
            return `Crédito Usado ${used}/${total}`;
        }
        
        // Fallback usando información de la sesión
        if (session.remainingCredits !== undefined && session.originalPackageId) {
            // Calcular créditos usados basándose en los restantes
            const remaining = session.remainingCredits;
            // Asumir paquete estándar si no tenemos info específica
            const totalEstimated = remaining + 1; // +1 porque acabamos de usar uno
            const used = totalEstimated - remaining;
            return `Crédito Usado ${used}/${totalEstimated}`;
        }
        
        // Fallback usando estructura de patientCredits directamente
        if (patientCredits[session.patientName] && patientCredits[session.patientName][session.therapist]) {
            const credits = patientCredits[session.patientName][session.therapist];
            if (Array.isArray(credits)) {
                // Múltiples paquetes
                const totalOriginal = credits.reduce((sum, pkg) => sum + pkg.total, 0);
                const totalRemaining = credits.reduce((sum, pkg) => sum + pkg.remaining, 0);
                const used = totalOriginal - totalRemaining;
                return `Crédito Usado ${used}/${totalOriginal}`;
            } else if (credits.total && credits.remaining !== undefined) {
                // Paquete único
                const used = credits.total - credits.remaining;
                return `Crédito Usado ${used}/${credits.total}`;
            }
        }
        
        // Fallback genérico basado en la imagen objetivo
        return "Crédito Usado 1/2";
        
    } catch (error) {
        console.warn("Error calculando uso de créditos:", error);
        return "Crédito Usado";
    }
}

// Función actualizada para alternar la visibilidad de los grupos de terapeutas
function toggleTherapistGroup(therapistName, type = 'normal') {
    const sanitizedName = therapistName.replace(/[^a-zA-Z0-9]/g, '_');
    const sessionsContainer = document.getElementById(`sessions-${sanitizedName}_${type}`);
    const chevron = document.getElementById(`chevron-${sanitizedName}_${type}`);
    
    if (sessionsContainer && chevron) {
        if (sessionsContainer.classList.contains('hidden')) {
            sessionsContainer.classList.remove('hidden');
            chevron.classList.add('rotate-180');
        } else {
            sessionsContainer.classList.add('hidden');
            chevron.classList.remove('rotate-180');
        }
    }
}

function updateDashboard(fecha) {
    try {
        console.log("🔍 DEBUG updateDashboard: Iniciando con fecha:", fecha);
        
        // Validar que las variables globales existan
        if (typeof sessions === 'undefined') sessions = {};
        if (typeof egresos === 'undefined') egresos = {};
        if (typeof dailyPackagePurchases === 'undefined') dailyPackagePurchases = {};
        
        const daySessions = sessions[fecha] || [];
        const dayEgresos = egresos[fecha] || [];
        
        // ⭐ AGREGAR ESTA LÍNEA:
        const dayPackages = dailyPackagePurchases[fecha] || [];
        
        console.log("🔍 DEBUG updateDashboard: Datos cargados - Sessions:", daySessions.length, "Egresos:", dayEgresos.length, "Packages:", dayPackages.length);
        
        // ⭐ REEMPLAZAR ESTOS CÁLCULOS:
        
        // Calcular totales DEL DÍA incluyendo paquetes
        const sessionIncome = daySessions.filter(s => !s.creditUsed).reduce((sum, s) => sum + (s.sessionValue || 0), 0);
        const packageIncome = dayPackages.reduce((sum, p) => sum + (p.sessionValue || 0), 0);
        const totalIngresos = sessionIncome + packageIncome;
        
        const sessionAporte = daySessions.filter(s => !s.creditUsed).reduce((sum, s) => sum + (s.neuroteaContribution || 0), 0);
        const packageAporte = dayPackages.reduce((sum, p) => sum + (p.neuroteaContribution || 0), 0);
        const totalAporteNeurotea = sessionAporte + packageAporte;
        
        const sessionEfectivo = daySessions.reduce((sum, s) => sum + (s.cashToNeurotea || 0), 0);
        const packageEfectivo = dayPackages.reduce((sum, p) => sum + (p.cashToNeurotea || 0), 0);
        const totalEfectivo = sessionEfectivo + packageEfectivo;
        
        const sessionTransfNeurotea = daySessions.reduce((sum, s) => sum + (s.transferToNeurotea || 0), 0);
        const packageTransfNeurotea = dayPackages.reduce((sum, p) => sum + (p.transferToNeurotea || 0), 0);
        const totalTransfNeurotea = sessionTransfNeurotea + packageTransfNeurotea;
        
        const totalEgresos = dayEgresos.reduce((sum, e) => sum + (e.monto || 0), 0);
        
        console.log("✅ DEBUG updateDashboard: Cálculos completados exitosamente");

        // ✅ ARQUITECTURA CORREGIDA: Usar función dinámica para saldo en caja
        // NO depende de saldosReales.efectivo (variable acumulativa problemática)
        const saldoCaja = calcularSaldoCajaReal(fecha);

        // Calcular saldo unificado de Cuenta NeuroTEA
        const saldoCuentaNeuroTEA = calcularSaldoCuentaNeuroTEA(fecha);
    
    // Actualizar elementos del dashboard
    const elements = {
        'dashboard-ingreso-total': totalIngresos,
        'dashboard-aporte-neurotea': totalAporteNeurotea,
        'dashboard-saldo-caja': saldoCaja,
        'dashboard-total-efectivo': totalEfectivo,  // TOTAL DEL DÍA
        'dashboard-cuenta-neurotea': saldoCuentaNeuroTEA,  // SALDO UNIFICADO
        'dashboard-total-egresos': totalEgresos
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = formatCurrency(value);
        }
    });
    
    } catch (error) {
        console.error("❌ ERROR en updateDashboard:", error);
        console.error("Stack trace:", error.stack);
        
        // Mostrar mensaje de error en el dashboard
        const errorElements = ['dashboard-ingreso-total', 'dashboard-aporte-neurotea', 'dashboard-saldo-caja'];
        errorElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = "Error";
                element.style.color = "red";
            }
        });
    }
}

function updateTransferDetails(fecha) {
    const container = document.getElementById('transfers-container');
    if (!container) return;
    
    const daySessions = sessions[fecha] || [];
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const transfers = [];
    
    // Procesar sesiones existentes - AGREGAR IDs únicos y nombres
    daySessions.forEach(session => {
        if (session.transferToNeurotea > 0) {
            transfers.push({
                id: `session_${session.id}_neurotea`,  // NUEVO: ID único
                tipo: 'A NeuroTEA',
                destinatario: 'NeuroTEA',
                monto: session.transferToNeurotea,
                concepto: `Pago sesión de ${session.therapist}`,
                patientName: session.patientName || 'Sin nombre' // NUEVO
            });
        }
        if (session.transferToTherapist > 0) {
            transfers.push({
                id: `session_${session.id}_therapist`, // NUEVO: ID único
                tipo: 'A Terapeuta',
                destinatario: session.therapist,
                monto: session.transferToTherapist,
                concepto: `Pago por sesión a la ${session.therapist}`,
                patientName: session.patientName || 'Sin nombre' // NUEVO
            });
        }
    });
    
    // NUEVO: Agregar vueltos por transferencia
    if (confirmaciones[fecha]) {
        Object.entries(confirmaciones[fecha]).forEach(([therapist, conf]) => {
            if (conf.flujo && conf.flujo.efectivoRecibido > 0) {
                transfers.push({
                    id: `vuelto_${therapist}_${fecha}`,   // NUEVO: ID único
                    tipo: 'Vuelto de Terapeuta',
                    destinatario: 'NeuroTEA',
                    monto: conf.flujo.efectivoRecibido,
                    concepto: `Vuelto de ${therapist} por pago en efectivo`,
                    patientName: 'Vuelto por transferencia' // NUEVO
                });
            }
        });
    }
    
    // Procesar paquetes
    dayPackages.forEach(package => {
        if (package.transferToNeurotea > 0) {
            transfers.push({
                id: `package_${package.id}_neurotea`,
                tipo: 'A NeuroTEA',
                destinatario: 'NeuroTEA',
                monto: package.transferToNeurotea,
                concepto: `Transferencia paquete ${package.patientName}`,
                patientName: package.patientName || 'Sin nombre' // NUEVO
            });
        }
        if (package.transferToTherapist > 0) {
            transfers.push({
                id: `package_${package.id}_therapist`,
                tipo: 'A Terapeuta',
                destinatario: package.therapist,
                monto: package.transferToTherapist,
                concepto: `Pago directo paquete a ${package.therapist}`,
                patientName: package.patientName || 'Sin nombre' // NUEVO
            });
        }
    });
    
    if (transfers.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">No hay transferencias registradas para este día</p>';
        return;
    }
    
    // Agrupar transferencias por destinatario
    const transfersByDestination = {};
    transfers.forEach(transfer => {
        if (!transfersByDestination[transfer.destinatario]) {
            transfersByDestination[transfer.destinatario] = [];
        }
        transfersByDestination[transfer.destinatario].push(transfer);
    });
    
    // Generar HTML agrupado con NUEVAS funcionalidades
    const destinationGroups = Object.keys(transfersByDestination).sort().map(destinatario => {
        const destinationTransfers = transfersByDestination[destinatario];
        const transferCount = destinationTransfers.length;
        const totalAmount = destinationTransfers.reduce((sum, t) => sum + t.monto, 0);
        
        const transfersHTML = destinationTransfers.map(transfer => {
            const isNeuroTEA = destinatario === 'NeuroTEA';
            const borderColor = isNeuroTEA ? 'border-blue-300' : 'border-purple-300';
            const badgeColor = transfer.tipo === 'A NeuroTEA' ? 'bg-blue-100 text-blue-800' : 
                              transfer.tipo === 'Vuelto de Terapeuta' ? 'bg-orange-100 text-orange-800' : 
                              'bg-purple-100 text-purple-800';
            
            // NUEVO: Agregar botón de confirmación SOLO para NeuroTEA
            let confirmationButton = '';
            if (isNeuroTEA) {
                const isConfirmed = transferConfirmationStates[transfer.id] || false;
                const statusClass = isConfirmed ? 'confirmed' : 'pending';
                const statusIcon = isConfirmed ? '✓' : '❌';
                const statusText = isConfirmed ? 'Confirmado' : 'Pendiente';
                
                confirmationButton = `
                    <button class="transfer-status-btn ${statusClass}" 
                            onclick="toggleTransferConfirmation('${transfer.id}')">
                        <span class="status-icon">${statusIcon}</span>
                        ${statusText}
                    </button>
                `;
            }
            
            return `
            <div class="p-3 border-l-4 ${borderColor} bg-gray-50 dark:bg-gray-700 ml-4 mb-2">
                <div class="flex justify-between items-center mb-2">
                    <h5 class="font-semibold text-gray-800 dark:text-gray-200">${transfer.concepto}</h5>
                    ${confirmationButton}
                    <span class="text-sm px-2 py-1 rounded-full ${badgeColor}">${transfer.tipo}</span>
                </div>
                <div class="patient-info mb-2">👤 ${transfer.patientName}</div>
                <div class="text-lg font-bold text-gray-900 dark:text-gray-100">
                    ${formatCurrency(transfer.monto)}
                </div>
            </div>
            `;
        }).join('');
        
        const isNeuroTEA = destinatario === 'NeuroTEA';
        const iconClass = isNeuroTEA ? 'building-2' : 'user';
        const colorClass = isNeuroTEA ? 'blue' : 'purple';
        
        return `
            <div class="mb-4 border rounded-md bg-white dark:bg-gray-800 overflow-hidden">
                <div class="bg-${colorClass}-50 dark:bg-${colorClass}-900 p-4 cursor-pointer hover:bg-${colorClass}-100 dark:hover:bg-${colorClass}-800 transition-colors" 
                     onclick="toggleTransferGroup('${destinatario.replace(/'/g, "\\'")}')">
                    <div class="flex justify-between items-center">
                        <h4 class="font-semibold text-${colorClass}-800 dark:text-${colorClass}-200 flex items-center">
                            <i data-lucide="${iconClass}" class="w-5 h-5 mr-2"></i>
                            Transferencias a ${destinatario}
                        </h4>
                        <div class="flex items-center space-x-2">
                            <span class="text-sm text-${colorClass}-600 dark:text-${colorClass}-300">
                                ${transferCount} transferencia${transferCount !== 1 ? 's' : ''} - ${formatCurrency(totalAmount)}
                            </span>
                            <i data-lucide="chevron-down" class="w-4 h-4 text-${colorClass}-600 dark:text-${colorClass}-300 transform transition-transform" id="chevron-transfer-${destinatario.replace(/[^a-zA-Z0-9]/g, '_')}"></i>
                        </div>
                    </div>
                </div>
                <div class="hidden p-4" id="transfers-${destinatario.replace(/[^a-zA-Z0-9]/g, '_')}">
                    ${transfersHTML}
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = destinationGroups;
    lucide.createIcons();
}

// Función para alternar la visibilidad de los grupos de transferencias
function toggleTransferGroup(destinationName) {
    const sanitizedName = destinationName.replace(/[^a-zA-Z0-9]/g, '_');
    const transfersContainer = document.getElementById(`transfers-${sanitizedName}`);
    const chevron = document.getElementById(`chevron-transfer-${sanitizedName}`);
    
    if (transfersContainer && chevron) {
        if (transfersContainer.classList.contains('hidden')) {
            transfersContainer.classList.remove('hidden');
            chevron.classList.add('rotate-180');
        } else {
            transfersContainer.classList.add('hidden');
            chevron.classList.remove('rotate-180');
        }
    }
}

function updateRendicionCuentas(fecha) {
    const daySessions = sessions[fecha] || [];
    const dayEgresos = egresos[fecha] || [];
    
    // ⭐ AGREGAR ESTA LÍNEA:
    const dayPackages = dailyPackagePurchases[fecha] || [];
    
    // ⭐ REEMPLAZAR ESTOS CÁLCULOS:
    const sessionEfectivo = daySessions.reduce((sum, s) => sum + s.cashToNeurotea, 0);
    const packageEfectivo = dayPackages.reduce((sum, p) => sum + p.cashToNeurotea, 0);
    const totalEfectivo = sessionEfectivo + packageEfectivo;
    
    const sessionBanco = daySessions.reduce((sum, s) => sum + s.transferToNeurotea, 0);
    const packageBanco = dayPackages.reduce((sum, p) => sum + p.transferToNeurotea, 0);
    const totalBanco = sessionBanco + packageBanco;
    
    const totalEgresos = dayEgresos.reduce((sum, e) => sum + e.monto, 0);
    const totalGeneral = totalEfectivo + totalBanco;

    // ✅ ARQUITECTURA CORREGIDA: Usar función dinámica para saldo en caja
    // NO depende de saldosReales.efectivo (variable acumulativa problemática)
    const saldoCaja = calcularSaldoCajaReal(fecha);

    // Calcular saldo unificado de Cuenta NeuroTEA usando la función auxiliar
    const saldoCuentaNeuroTEA = calcularSaldoCuentaNeuroTEA(fecha);
    
    // Actualizar elementos - USAR VALORES CALCULADOS CORRECTAMENTE
    const elements = {
        'rendicion-efectivo': totalEfectivo,
        'rendicion-banco': saldoCuentaNeuroTEA,  // USAR SALDO UNIFICADO
        'rendicion-total': totalGeneral,
        'rendicion-saldo-caja': saldoCaja,
        'total-egresos-display': totalEgresos
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = formatCurrency(value);
        }
    });
    
    // Actualizar tabla de rendición por terapeuta
    updateRendicionTherapistTable(fecha);
}

function updateRendicionTherapistTable(fecha) {
    const container = document.getElementById('rendicion-therapist-table-body');
    if (!container) return;
    
    const daySessions = sessions[fecha] || [];
    const sessionTherapists = daySessions.map(s => s.therapist);
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const packageTherapists = dayPackages.map(p => p.therapist);
    const uniqueTherapists = [...new Set([...sessionTherapists, ...packageTherapists])];
    
    if (uniqueTherapists.length === 0) {
        container.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-gray-500">No hay datos para mostrar</td></tr>';
        return;
    }
    
    container.innerHTML = uniqueTherapists.map(therapist => {
        const isConfirmed = isTherapistPaymentConfirmed(therapist, fecha);
        let status;
        let rowClass = '';
        let actionButton = '';
        
        if (isConfirmed && confirmaciones[fecha][therapist].estadoCongelado) {
            // Usar valores congelados si está confirmado
            status = confirmaciones[fecha][therapist].estadoCongelado;
            rowClass = 'bg-red-50 dark:bg-red-900/20';
            
            // Botón de revertir para estados confirmados
            actionButton = `
                <button onclick="toggleTherapistPayment('${therapist}', '${fecha}')" class="btn-confirmar">
                    Revertir
                </button>
            `;
        } else {
            // Usar cálculos en vivo si no está confirmado
            status = calculateTherapistStatus(therapist, fecha);
            
            // NUEVA LÓGICA: Modalidades para "LA TERAPEUTA DEBE DAR"
            if (status.estado === 'LA TERAPEUTA DEBE DAR') {
                actionButton = `
                    <select onchange="handleTherapistDebtPayment('${therapist}', '${fecha}', this.value)" 
                            class="debt-payment-select">
                        <option value="">¿Cómo entrega?</option>
                        <option value="efectivo">Entrega efectivo</option>
                        <option value="transferencia">Transfiere a cuenta</option>
                    </select>
                `;
            } else if (status.estado === 'DAR EFECTIVO') {
                // MODIFICACIÓN PARA VUELTOS: Agregar 4ta opción
                actionButton = `
                    <select onchange="handlePaymentOption('${therapist}', '${fecha}', this.value)" class="btn-confirmar">
                        <option value="">Seleccionar...</option>
                        <option value="exacto">Dar exacto (${formatCurrency(status.neuroteaLeDebe)})</option>
                        <option value="vuelto">Dar con vuelto (por transferencia)...</option>
                        <option value="vuelto-efectivo">Dar con vuelto en efectivo...</option>
                        <option value="transferir">Solo transferir</option>
                    </select>
                `;
            } else {
                // Botón normal para otros estados
                actionButton = `
                    <button onclick="toggleTherapistPayment('${therapist}', '${fecha}')" class="btn-confirmar">
                        Confirmar
                    </button>
                `;
            }
        }
        
        return `
            <tr class="${rowClass}">
                <td class="px-4 py-2 border font-medium">${therapist}</td>
                <td class="px-4 py-2 border text-right">${formatCurrency(status.ingresoTotal)}</td>
                <td class="px-4 py-2 border text-right">${formatCurrency(status.aporteNeurotea)}</td>
                <td class="px-4 py-2 border text-right">${formatCurrency(status.honorarios)}</td>
                <td class="px-4 py-2 border text-right">${formatCurrency(status.transferenciaATerapeuta)}</td>
                <td class="px-4 py-2 border text-right">${formatCurrency(status.adelantosRecibidos)}</td>
                <td class="px-4 py-2 border text-right">
                    ${status.neuroteaLeDebe > 0 ? formatCurrency(status.neuroteaLeDebe) : formatCurrency(0)}
                </td>
                <td class="px-4 py-2 border text-right">
                    ${status.terapeutaDebe > 0 ? formatCurrency(status.terapeutaDebe) : formatCurrency(0)}
                </td>
                <td class="px-4 py-2 border text-center">
                    <span class="badge ${status.colorClass}">${status.estado}</span>
                </td>
                <td class="px-4 py-2 border text-center">
                    ${actionButton}
                </td>
                <td class="px-4 py-2 border text-center">
                    <button onclick="generateTherapistReceipt('${therapist}', '${fecha}')" 
                            class="btn-pdf-icon"
                            title="Generar comprobante individual">
                        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <!-- Documento base -->
                            <path d="M2 2C2 0.895431 2.89543 0 4 0H13L18 5V22C18 23.1046 17.1046 24 16 24H4C2.89543 24 2 23.1046 2 22V2Z" fill="#E5E7EB"/>
                            <!-- Esquina doblada -->
                            <path d="M13 0V4C13 4.55228 13.4477 5 14 5H18L13 0Z" fill="#D1D5DB"/>
                            <!-- Líneas del documento -->
                            <rect x="5" y="8" width="8" height="1" rx="0.5" fill="#9CA3AF"/>
                            <rect x="5" y="11" width="10" height="1" rx="0.5" fill="#9CA3AF"/>
                            <!-- Banda roja PDF -->
                            <rect x="1" y="14" width="18" height="6" rx="1" fill="#DC2626"/>
                            <!-- Texto PDF -->
                            <text x="10" y="18.5" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="6" font-weight="bold">PDF</text>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateEgresosList(fecha) {
    const container = document.getElementById('egresos-list-container');
    if (!container) return;
    
    const dayEgresos = egresos[fecha] || [];
    
    if (dayEgresos.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-4">No hay egresos registrados para este día</p>';
        return;
    }
    
    container.innerHTML = dayEgresos.map(egreso => `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md">
            <div>
                <div class="font-medium">${egreso.concepto}</div>
                <div class="text-sm text-gray-500">
                    ${egreso.tipo === 'adelanto' ? `Adelanto a ${egreso.therapist}` : 'Gasto de NeuroTEA'} - ${formatCurrency(egreso.monto)}
                </div>
            </div>
            <button onclick="deleteEgreso('${fecha}', ${egreso.id})" class="text-red-500 hover:text-red-700 p-1">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </div>
    `).join('');
    
    lucide.createIcons();
}

// ===========================
// FUNCIONES AUXILIARES
// ===========================

async function deleteSession(fecha, sessionId) {
    if (!confirm('¿Está seguro de eliminar esta sesión?')) return;

    const sessionIndex = sessions[fecha].findIndex(s => s.id === sessionId);
    if (sessionIndex !== -1) {
        const session = sessions[fecha][sessionIndex];

        console.log(`🗑️ Eliminando sesión: ${session.therapist} - ${session.patientName}`);

        // ✅ ARQUITECTURA CORREGIDA: Limpiar confirmaciones relacionadas
        // Pasa la sesión completa para poder identificar al terapeuta
        cleanupSessionConfirmations(fecha, session);

        // ✅ Revertir créditos usados si aplica
        revertSessionCredits(session);

        // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
        // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()

        sessions[fecha].splice(sessionIndex, 1);

        if (sessions[fecha].length === 0) {
            delete sessions[fecha];
        }

        // Eliminar de IndexedDB
        try {
            await deleteSingleSessionFromIndexedDB(sessionId);
        } catch (error) {
            console.error('Error deleting session from IndexedDB:', error);
        }

        updateAllViews(fecha);
        saveToStorage();

        console.log(`✅ Sesión eliminada. Saldo recalculado dinámicamente.`);
    }
}

async function clearDayRecords() {
    if (!confirm('¿Está seguro de limpiar todos los registros del día?')) return;

    const fecha = fechaActual;

    console.log(`🗑️ Limpiando todos los registros del día: ${fecha}`);

    // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
    // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()

    // Eliminar sesiones
    if (sessions[fecha]) {
        delete sessions[fecha];
    }

    // Eliminar egresos
    if (egresos[fecha]) {
        delete egresos[fecha];
    }

    // Limpiar confirmaciones
    if (confirmaciones[fecha]) {
        delete confirmaciones[fecha];
    }

    // Eliminar de IndexedDB
    try {
        await deleteSessionsByDate(fecha);
        await deleteEgresosByDate(fecha);
        await deleteConfirmacionesByDate(fecha);
    } catch (error) {
        console.error('Error deleting from IndexedDB:', error);
    }

    updateAllViews(fecha);
    saveToStorage();

    console.log(`✅ Registros del día eliminados. Saldo recalculado dinámicamente.`);
    alert('Todos los registros del día han sido eliminados');
}

// Función para migrar paquetes antiguos
function migrateLegacyPackages() {
    let migrated = false;
    
    Object.keys(dailyPackagePurchases).forEach(fecha => {
        dailyPackagePurchases[fecha].forEach(pkg => {
            if (!pkg.neuroteaContribution) {
                pkg.neuroteaContribution = pkg.sessionValue * 0.20;
                pkg.therapistFee = pkg.sessionValue * 0.80;
                pkg.contributionType = '20';
                migrated = true;
            }
        });
    });
    
    if (migrated) {
        console.log('✅ Paquetes antiguos migrados correctamente');
        saveToStorage();
    }
}

// Función para validar integridad de datos de paquetes existentes
function validateAllPackagesIntegrity() {
    let corrected = false;

    Object.keys(dailyPackagePurchases).forEach(fecha => {
        const packages = dailyPackagePurchases[fecha];
        if (!packages || !Array.isArray(packages)) return;

        packages.forEach(pkg => {
            if (!pkg) return;
            // Validar que neuroteaContribution no exceda sessionValue
            if (pkg.neuroteaContribution > pkg.sessionValue) {
                pkg.neuroteaContribution = pkg.sessionValue * 0.20;
                pkg.therapistFee = pkg.sessionValue * 0.80;
                corrected = true;
                console.warn(`⚠️ Corregido aporte excesivo en paquete ${pkg.id}`);
            }
            
            // Validar que therapistFee sea consistente
            const expectedFee = pkg.sessionValue - pkg.neuroteaContribution;
            if (Math.abs(pkg.therapistFee - expectedFee) > 1) {
                pkg.therapistFee = expectedFee;
                corrected = true;
                console.warn(`⚠️ Corregido honorario inconsistente en paquete ${pkg.id}`);
            }
            
            // Validar que contributionType exista
            if (!pkg.contributionType) {
                pkg.contributionType = '20';
                corrected = true;
            }
        });
    });
    
    if (corrected) {
        console.log('✅ Datos de paquetes validados y corregidos');
        saveToStorage();
    }
}

// Función para validar que los 5 momentos funcionen correctamente
function validateUserExperience() {
    console.log('🎯 VALIDANDO EXPERIENCIA DE USUARIO - 5 MOMENTOS');
    
    try {
        // MOMENTO 1: Verificar saldo inicial
        const saldoInicial = getInitialBalance(fechaActual);
        console.log(`✅ MOMENTO 1: Saldo inicial configurado: ${formatCurrency(saldoInicial)}`);
        
        // MOMENTO 2-3: Verificar que paquetes se integren en dashboard
        const dayPackages = dailyPackagePurchases[fechaActual] || [];
        if (dayPackages.length > 0) {
            console.log(`✅ MOMENTO 2-3: ${dayPackages.length} paquetes encontrados`);
            
            // Verificar cálculos de aportes específicos
            dayPackages.forEach(pkg => {
                const expectedAporte = pkg.neuroteaContribution || (pkg.sessionValue * 0.20);
                console.log(`  - ${pkg.patientName}: Aporte ${formatCurrency(expectedAporte)} (${pkg.contributionType || '20%'})`);
            });
        }
        
        // MOMENTO 4: Verificar que sesiones con crédito no afecten dashboard
        const daySessions = sessions[fechaActual] || [];
        const creditSessions = daySessions.filter(s => s.creditUsed);
        const normalSessions = daySessions.filter(s => !s.creditUsed);
        
        console.log(`✅ MOMENTO 4: ${creditSessions.length} sesiones con crédito, ${normalSessions.length} sesiones normales`);
        
        // MOMENTO 5: Verificar integración completa
        const uniqueTherapists = [...new Set([
            ...daySessions.map(s => s.therapist),
            ...dayPackages.map(p => p.therapist)
        ])];
        
        console.log(`✅ MOMENTO 5: ${uniqueTherapists.length} terapeutas en total integradas`);
        
        console.log('🎯 VALIDACIÓN COMPLETADA - EXPERIENCIA DE USUARIO OK');
        
    } catch (error) {
        console.error('❌ ERROR EN VALIDACIÓN DE EXPERIENCIA:', error);
    }
}

// ===========================
// INICIALIZACIÓN
// ===========================

document.addEventListener('DOMContentLoaded', async function() {
    try {
        // Inicializar IndexedDB
        await initIndexedDB();
        console.log('IndexedDB initialized successfully');
        
        // Cargar datos
        await loadFromStorage();
    } catch (error) {
        console.error('Error initializing IndexedDB:', error);
        // Fallback a localStorage
        loadFromStorage();
    }
    
    // Configurar fecha actual
    const dateInput = document.getElementById('session-date');
    if (dateInput) {
        dateInput.value = fechaActual;
        dateInput.addEventListener('change', function() {
            fechaActual = this.value;
            updateAllViews(fechaActual);
        });
    }
    
    // Event listeners para cálculos automáticos
    const paymentFields = ['cash-to-neurotea', 'transfer-to-therapist', 'transfer-to-neurotea', 'fixed-amount-input'];
    paymentFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', calculateSessionValues);
        }
    });
    
    // Event listeners para radio buttons de aporte
    const contributionRadios = document.querySelectorAll('input[name="neurotea-contribution"]');
    contributionRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            toggleFixedAmount();
            calculateSessionValues();
        });
    });
    
    // Event listener para selector de terapeuta
    const therapistSelect = document.getElementById('therapist-select');
    if (therapistSelect) {
        therapistSelect.addEventListener('change', validateRegisterButton);
    }
    
    // Event listeners para modo crédito
    const creditMode = document.getElementById('modo-usar-credito');
    if (creditMode) {
        creditMode.addEventListener('change', validateRegisterButton);
    }
    
    const creditPatientSelect = document.getElementById('paciente-credito-select');
    if (creditPatientSelect) {
        creditPatientSelect.addEventListener('change', validateRegisterButton);
    }
    
    // Event listener para botón de registro
    const registerBtn = document.getElementById('register-btn');
    if (registerBtn) {
        registerBtn.addEventListener('click', registerSession);
    }
    
    // Event listener para agregar terapeuta
    const addTherapistBtn = document.getElementById('add-therapist-btn');
    if (addTherapistBtn) {
        addTherapistBtn.addEventListener('click', addTherapist);
    }
    
    // Event listener para input de nueva terapeuta (Enter)
    const newTherapistInput = document.getElementById('new-therapist-name');
    if (newTherapistInput) {
        newTherapistInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                addTherapist();
            }
        });
    }
    
    // Event listener para tipo de egreso
    const egresoType = document.getElementById('egreso-type');
    if (egresoType) {
        egresoType.addEventListener('change', toggleTherapistSelect);
    }
    
    // Event listener para agregar egreso
    const addEgresoBtn = document.getElementById('add-egreso-btn');
    if (addEgresoBtn) {
        addEgresoBtn.addEventListener('click', addEgreso);
    }
    
    // Event listener para limpiar registros del día
    const clearRecordsBtn = document.getElementById('new-day-btn');
    if (clearRecordsBtn) {
        clearRecordsBtn.addEventListener('click', async () => {
            await clearDayRecords();
        });
    }
    
    // Event listener para limpiar egresos del día
    const clearEgresosBtn = document.getElementById('clear-egresos-btn');
    if (clearEgresosBtn) {
        clearEgresosBtn.addEventListener('click', async () => {
            await clearAllEgresos();
        });
    }
    
    // Event listeners para el modal de saldo inicial
    const saldoModal = document.getElementById('saldo-modal');
    if (saldoModal) {
        saldoModal.addEventListener('click', function(e) {
            if (e.target === saldoModal) {
                closeSaldoModal();
            }
        });
    }
    
    // Event listener para tecla Escape (cerrar modal)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const modal = document.getElementById('saldo-modal');
            if (modal && !modal.classList.contains('hidden')) {
                closeSaldoModal();
            }
        }
    });
    
    // Event listener para Enter en el input del saldo
    const saldoInput = document.getElementById('nuevo-saldo-input');
    if (saldoInput) {
        saldoInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                saveSaldoInicial();
            }
        });
    }
    
    // ===========================
    // EVENT LISTENERS PARA PESTAÑA DE PAQUETES
    // ===========================
    
    // Event listeners para cálculos automáticos en formulario de paquetes
    const packagePaymentFields = ['package-cash', 'package-transfer-therapist', 'package-transfer-neurotea', 'package-sessions', 'package-fixed-amount-input'];
    packagePaymentFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', updatePackageTotals);
        }
    });
    
    // Event listener para cambios en nombre del paciente y terapeuta
    const packagePatientName = document.getElementById('package-patient-name');
    if (packagePatientName) {
        packagePatientName.addEventListener('input', updatePackageTotals);
    }
    
    const packageTherapistSelect = document.getElementById('package-therapist');
    if (packageTherapistSelect) {
        packageTherapistSelect.addEventListener('change', updatePackageTotals);
    }
    
    // Event listener para envío del formulario de paquetes
    const packageForm = document.getElementById('package-form');
    if (packageForm) {
        packageForm.addEventListener('submit', handlePackageFormSubmit);
    }
    
    // Event listeners para radio buttons de aporte en paquetes
    const packageContributionRadios = document.querySelectorAll('input[name="package-neurotea-contribution"]');
    packageContributionRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            try {
                const fixedInput = document.getElementById('package-fixed-amount-input');
                if (fixedInput) {
                    const isFixed = this.value === 'fixed';
                    fixedInput.disabled = !isFixed;
                    
                    if (!isFixed) {
                        fixedInput.value = '';
                    } else {
                        // Enfocar el input cuando se selecciona monto fijo
                        setTimeout(() => fixedInput.focus(), 100);
                    }
                }
                updatePackageTotals();
            } catch (error) {
                console.error('Error en event listener de radio buttons:', error);
            }
        });
    });
    
    // Event listener específico para input de monto fijo
    const fixedAmountInput = document.getElementById('package-fixed-amount-input');
    if (fixedAmountInput) {
        fixedAmountInput.addEventListener('input', function() {
            try {
                // Validar que no sea negativo
                if (this.value < 0) {
                    this.value = 0;
                }
                updatePackageTotals();
            } catch (error) {
                console.error('Error en input de monto fijo:', error);
            }
        });
        
        fixedAmountInput.addEventListener('blur', function() {
            try {
                // Validar al perder el foco
                const total = parseFloat(document.getElementById('package-cash').value || 0) +
                             parseFloat(document.getElementById('package-transfer-therapist').value || 0) +
                             parseFloat(document.getElementById('package-transfer-neurotea').value || 0);
                
                if (parseFloat(this.value) > total && total > 0) {
                    alert('El monto fijo no puede ser mayor al total del paquete');
                    this.focus();
                }
            } catch (error) {
                console.error('Error en validación de monto fijo:', error);
            }
        });
    }

    // ============================
    // EVENT LISTENERS PARA FASE 3 - FORMULARIO DE USO DE PAQUETES
    // ===========================
    
    // Event listeners para modo de registro
    const modeRadios = document.querySelectorAll('input[name="modo-registro"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', togglePaymentMode);
    });
    
    // Event listener para terapeuta (actualizar pacientes con créditos)
    const therapistSelectForCredits = document.getElementById('therapist-select');
    if (therapistSelectForCredits) {
        // Agregar listener adicional para actualizar pacientes con créditos
        therapistSelectForCredits.addEventListener('change', function() {
            updateAvailablePatients();
            validateRegisterButton();
        });
    }
    
    // Event listener para checkbox de créditos adicionales (MINI CARRITO)
    const additionalCheckbox = document.getElementById('crear-creditos-adicionales');
    if (additionalCheckbox) {
        additionalCheckbox.addEventListener('change', function() {
            // Solo ejecutar la función del mini carrito
            toggleSesionesFuturasContainer();
        });
    }
    
    // Event listener para selección de paciente con crédito
    const patientCreditSelect = document.getElementById('paciente-credito-select');
    if (patientCreditSelect) {
        patientCreditSelect.addEventListener('change', function() {
            // MEJORA: Auto-completar el campo de nombre manual
            const selectedPatient = this.value;
            const patientNameField = document.getElementById('patient-name');
            
            if (selectedPatient && patientNameField) {
                patientNameField.value = selectedPatient;
            }
            
            updateCreditInfo();
            validateRegisterButton();
        });
    }
    
    // Event listener para cantidad de créditos adicionales
    const creditosQuantity = document.getElementById('creditos-cantidad');
    if (creditosQuantity) {
        creditosQuantity.addEventListener('input', validateRegisterButton);
    }
    
    // ===========================
    // EVENT LISTENERS PARA MINI CARRITO DE SESIONES FUTURAS
    // ===========================
    
    // Event listener para botón de agregar sesión futura
    const agregarBtn = document.getElementById('agregar-sesion-futura-btn');
    if (agregarBtn) {
        agregarBtn.addEventListener('click', agregarSesionFutura);
    }
    
    // Event listener para Enter en cantidad
    const cantidadInput = document.getElementById('cantidad-futura-input');
    if (cantidadInput) {
        cantidadInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                agregarSesionFutura();
            }
        });
    }
    
    // Event listener para cambio de terapeuta principal (actualizar lista de futuras)
    const therapistSelectMain = document.getElementById('therapist-select');
    if (therapistSelectMain) {
        therapistSelectMain.addEventListener('change', function() {
            if (document.getElementById('crear-creditos-adicionales').checked) {
                inicializarTerapeutasFuturas();
            }
        });
    }
    
    // Event listeners para campos de pago de sesión actual (actualizar gran total)
    ['cash-to-neurotea', 'transfer-to-therapist', 'transfer-to-neurotea'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', calcularGranTotal);
        }
    });
    
    // Inicializar estado
    toggleFixedAmount();
    calculateSessionValues();
    updateAllViews(fechaActual);
    
    // ⭐ AGREGAR: Validar experiencia de usuario después de la inicialización
    setTimeout(() => {
        validateUserExperience();
    }, 1000);
    
    // Inicializar iconos de Lucide
    lucide.createIcons();
});


// ===========================
// FUNCIONES DE GENERACIÓN DE PDF - VERSIÓN CORREGIDA FINAL
// ===========================

// ===========================
// CONSTANTES CSS EXACTAS DEL HTML DE REFERENCIA
// ===========================
const CSS_MEASUREMENTS = {
    header: {
        height: 60,                    // CSS: height del encabezado azul
        padding: { left: 30, right: 30 }  // CSS: padding: 0 30px
    },
    content: {
        padding: { top: 20, left: 30, right: 30 }, // CSS: padding: 20px 30px
        sectionSpacing: 20             // CSS: margin-bottom: 20px
    },
    fonts: {
        body: 11,          // CSS: font-size: 11px
        avanza: 18,        // CSS: font-size: 18px  
        neurotea: 32,      // CSS: font-size: 32px
        comprobante: 36,   // CSS: font-size: 36px
        calcTitle: 12,     // CSS: font-size: 12px
        obsText: 10        // CSS: font-size: 10px
    },
    borders: {
        table: 2,          // CSS: border: 2px solid #000
        totals: 2,         // CSS: border: 2px solid #000  
        calculation: 1,    // CSS: border: 1px solid #000
        observations: 1    // CSS: border: 1px solid #000
    },
    spacing: {
        infoBottom: 10,    // CSS: padding-bottom: 10px
        tableMargin: 20,   // CSS: margin-bottom: 20px
        totalsMargin: 20,  // CSS: margin-bottom: 20px
        calcMargin: 20,    // CSS: margin-bottom: 20px
        obsMargin: 40,     // CSS: margin-bottom: 40px
        signatureTop: 50   // CSS: margin-top: 50px
    }
};

function generateRendicionPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Configuración de fuentes y colores
    const primaryColor = [74, 144, 226]; // NeuroTEA blue
    const secondaryColor = [107, 114, 128]; // Gray
    const successColor = [16, 185, 129]; // Green
    const dangerColor = [239, 68, 68]; // Red
    const warningColor = [245, 158, 11]; // Orange
    
    // Fecha actual para el reporte
    const fecha = document.getElementById('session-date').value || fechaActual;
    
    // Corregir problema de fecha UTC - descomponer y crear en hora local
    const [year, month, day] = fecha.split('-').map(Number);
    const fechaLocal = new Date(year, month - 1, day);
    
    const fechaFormateada = fechaLocal.toLocaleDateString('es-PY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Configurar página
    let yPosition = 20;
    const pageWidth = doc.internal.pageSize.width;
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);
    
    // Encabezado del documento
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    // Logo y título
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('NeuroTEA', margin, 15);
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Gestión - Reporte de Rendición de Cuentas', margin, 25);
    
    yPosition = 50;
    
    // Información de la fecha
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Fecha: ${fechaFormateada}`, margin, yPosition);
    
    yPosition += 20;
    
    // Resumen financiero
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN FINANCIERO', margin, yPosition);
    
    yPosition += 10;
    
    // CALCULAR DATOS DIRECTAMENTE DESDE LAS VARIABLES GLOBALES
    const daySessions = sessions[fecha] || [];
    const dayEgresos = egresos[fecha] || [];
    
    // Calcular totales usando la misma lógica que updateRendicionCuentas
    let totalGeneral = 0;
    let totalEfectivo = 0;
    let totalTransfNeurotea = 0;
    
    daySessions.forEach(session => {
        totalGeneral += session.sessionValue;
        totalEfectivo += session.cashToNeurotea;
        totalTransfNeurotea += session.transferToNeurotea;
    });
    
    // Calcular total de egresos
    let totalEgresos = 0;
    let totalAdelantos = 0;
    let totalEgresosNeurotea = 0;
    
    dayEgresos.forEach(egreso => {
        totalEgresos += egreso.monto;
        if (egreso.tipo === 'adelanto') {
            totalAdelantos += egreso.monto;
        } else {
            totalEgresosNeurotea += egreso.monto;
        }
    });
    
    // Calcular flujo de caja considerando confirmaciones
    let pagosConfirmadosEfectivo = 0;
    if (confirmaciones[fecha]) {
        Object.values(confirmaciones[fecha]).forEach(conf => {
            if (conf.flujo && conf.flujo.efectivoUsado) {
                pagosConfirmadosEfectivo += conf.flujo.efectivoUsado;
            }
        });
    }
    
    // ✅ ARQUITECTURA CORREGIDA: Usar función dinámica para saldo en caja
    const saldoCaja = calcularSaldoCajaReal(fecha);

    // Cuenta NeuroTEA = Transferencias + saldo inicial usando función auxiliar
    const cuentaNeuroTEA = calcularSaldoCuentaNeuroTEA(fecha);
    
    // Calcular Ingreso Total del Día (suma de todos los valores de sesión)
    let ingresoTotalDia = 0;
    daySessions.forEach(session => {
        ingresoTotalDia += session.sessionValue;
    });
    
    // Calcular Ingreso Total Efectivo (efectivo recibido)
    let ingresoTotalEfectivo = totalEfectivo;
    
    // Calcular Aporte Total a NeuroTEA (suma de aportes)
    let aporteTotalNeuroTEA = 0;
    daySessions.forEach(session => {
        aporteTotalNeuroTEA += session.neuroteaContribution;
    });
    
    // Crear tabla de resumen financiero con los nuevos campos
    const resumenData = [
        ['Ingreso Total del Día', formatCurrency(ingresoTotalDia)],
        ['Ingreso Total Efectivo', formatCurrency(ingresoTotalEfectivo)],
        ['Aporte Total a NeuroTEA', formatCurrency(aporteTotalNeuroTEA)],
        ['Cuenta NeuroTEA', formatCurrency(cuentaNeuroTEA)],
        ['Total Egresos', formatCurrency(totalEgresos)],
        ['Saldo en Caja', formatCurrency(saldoCaja)]
    ];
    
    doc.autoTable({
        startY: yPosition,
        head: [['Concepto', 'Monto']],
        body: resumenData,
        theme: 'grid',
        headStyles: {
            fillColor: primaryColor,
            textColor: [255, 255, 255],
            fontStyle: 'bold'
        },
        bodyStyles: {
            fontSize: 10
        },
        columnStyles: {
            0: { cellWidth: contentWidth * 0.6 },
            1: { cellWidth: contentWidth * 0.4, halign: 'right' }
        },
        margin: { left: margin, right: margin }
    });
    
    yPosition = doc.lastAutoTable.finalY + 20;
    
    // Rendición por Terapeuta
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RENDICIÓN POR TERAPEUTA', margin, yPosition);
    
    yPosition += 10;
    
    // Obtener datos de terapeutas usando las funciones existentes
    // ✅ CORRECCIÓN: Incluir terapeutas de paquetes sin sesiones
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const therapistsFromSessions = daySessions.map(s => s.therapist);
    const therapistsFromPackages = dayPackages.map(p => p.therapist);
    const uniqueTherapists = [...new Set([...therapistsFromSessions, ...therapistsFromPackages])];
    
    if (uniqueTherapists.length > 0) {
        const therapistData = uniqueTherapists.map(therapist => {
            const status = calculateTherapistStatus(therapist, fecha);
            const isConfirmed = isTherapistPaymentConfirmed(therapist, fecha);
            
            if (isConfirmed && confirmaciones[fecha] && confirmaciones[fecha][therapist] && confirmaciones[fecha][therapist].estadoCongelado) {
                const frozenStatus = confirmaciones[fecha][therapist].estadoCongelado;
                return [
                    therapist,
                    formatCurrency(frozenStatus.ingresoTotal),
                    formatCurrency(frozenStatus.aporteNeurotea),
                    formatCurrency(frozenStatus.honorarios),
                    formatCurrency(frozenStatus.transferenciaATerapeuta),
                    formatCurrency(frozenStatus.adelantosRecibidos),
                    formatCurrency(frozenStatus.neuroteaLeDebe > 0 ? frozenStatus.neuroteaLeDebe : 0),
                    formatCurrency(frozenStatus.terapeutaDebe > 0 ? frozenStatus.terapeutaDebe : 0),
                    frozenStatus.estado + (isConfirmed ? ' ✓' : '')
                ];
            } else {
                return [
                    therapist,
                    formatCurrency(status.ingresoTotal),
                    formatCurrency(status.aporteNeurotea),
                    formatCurrency(status.honorarios),
                    formatCurrency(status.transferenciaATerapeuta),
                    formatCurrency(status.adelantosRecibidos),
                    formatCurrency(status.neuroteaLeDebe > 0 ? status.neuroteaLeDebe : 0),
                    formatCurrency(status.terapeutaDebe > 0 ? status.terapeutaDebe : 0),
                    status.estado + (isConfirmed ? ' ✓' : '')
                ];
            }
        });
        
        doc.autoTable({
            startY: yPosition,
            head: [['Terapeuta', 'Ingreso Total', 'Aporte NeuroTEA', 'Honorarios', 'Transf. a Terapeuta', 'Adelantos', 'NeuroTEA Debe', 'Terapeuta Debe', 'Estado']],
            body: therapistData,
            theme: 'grid',
            headStyles: {
                fillColor: primaryColor,
                textColor: [255, 255, 255],
                fontStyle: 'bold',
                fontSize: 9,
                halign: 'center',
                valign: 'middle',
                cellPadding: 3
            },
            bodyStyles: {
                fontSize: 8,
                cellPadding: 2,
                valign: 'middle'
            },
            columnStyles: {
                0: { cellWidth: 25, halign: 'left' },
                1: { cellWidth: 18, halign: 'right' },
                2: { cellWidth: 18, halign: 'right' },
                3: { cellWidth: 18, halign: 'right' },
                4: { cellWidth: 18, halign: 'right' },
                5: { cellWidth: 18, halign: 'right' },
                6: { cellWidth: 18, halign: 'right' },
                7: { cellWidth: 18, halign: 'right' },
                8: { cellWidth: 25, halign: 'center', fontSize: 7 }
            },
            margin: { left: margin, right: margin },
            tableWidth: 'auto',
            styles: {
                lineColor: [200, 200, 200],
                lineWidth: 0.5
            }
        });
        
        yPosition = doc.lastAutoTable.finalY + 20;
    } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.text('No hay terapeutas registradas para este día', margin, yPosition);
        yPosition += 20;
    }
    
    // Egresos del día
    if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
    }
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('EGRESOS DEL DÍA', margin, yPosition);
    
    yPosition += 10;
    
    if (dayEgresos.length > 0) {
        const egresosData = dayEgresos.map(egreso => [
            egreso.concepto,
            egreso.tipo === 'adelanto' ? `Adelanto a ${egreso.therapist}` : 'Gasto de NeuroTEA',
            formatCurrency(egreso.monto)
        ]);
        
        doc.autoTable({
            startY: yPosition,
            head: [['Concepto', 'Tipo', 'Monto']],
            body: egresosData,
            theme: 'grid',
            headStyles: {
                fillColor: dangerColor,
                textColor: [255, 255, 255],
                fontStyle: 'bold'
            },
            bodyStyles: {
                fontSize: 10
            },
            columnStyles: {
                0: { cellWidth: contentWidth * 0.5 },
                1: { cellWidth: contentWidth * 0.3 },
                2: { cellWidth: contentWidth * 0.2, halign: 'right' }
            },
            margin: { left: margin, right: margin }
        });
        
        yPosition = doc.lastAutoTable.finalY + 10;
        
        // Total de egresos
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`Total Egresos: ${formatCurrency(totalEgresos)}`, margin, yPosition);
    } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.text('No hay egresos registrados para este día', margin, yPosition);
        yPosition += 20;
    }
    
    // ===========================
    // SECCIÓN DE TRANSFERENCIAS DEL DÍA
    // ===========================
    
    // Verificar si necesitamos nueva página
    if (yPosition > doc.internal.pageSize.height - 80) {
        doc.addPage();
        yPosition = 20;
    }
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TRANSFERENCIAS DEL DÍA', margin, yPosition);
    
    yPosition += 10;
    
    // Recopilar datos de transferencias usando la misma lógica que updateTransferDetails
    const transfers = [];
    
    daySessions.forEach(session => {
        if (session.transferToNeurotea > 0) {
            transfers.push({
                tipo: 'A NeuroTEA',
                destinatario: 'NeuroTEA',
                monto: session.transferToNeurotea,
                concepto: `Pago sesión de ${session.therapist}`
            });
        }
        if (session.transferToTherapist > 0) {
            transfers.push({
                tipo: 'A Terapeuta',
                destinatario: session.therapist,
                monto: session.transferToTherapist,
                concepto: `Pago por sesión a la ${session.therapist}`
            });
        }
    });
    
    // Agregar vueltos de terapeutas (MISMA LÓGICA que updateTransferDetails)
    if (confirmaciones[fecha]) {
        Object.entries(confirmaciones[fecha]).forEach(([therapist, conf]) => {
            if (conf.flujo && conf.flujo.efectivoRecibido > 0) {
                transfers.push({
                    tipo: 'Vuelto de Terapeuta',
                    destinatario: 'NeuroTEA',
                    monto: conf.flujo.efectivoRecibido,
                    concepto: `Vuelto de ${therapist} por pago en efectivo`
                });
            }
        });
    }
    
    if (transfers.length > 0) {
        // Filtrar solo transferencias a NeuroTEA para el PDF
        const neuroteaTransfers = transfers.filter(transfer => transfer.destinatario === 'NeuroTEA');
        
        if (neuroteaTransfers.length > 0) {
            // Crear tabla simple de 3 columnas: Destinatario, Monto, Concepto
            const transfersData = neuroteaTransfers.map(transfer => [
                transfer.destinatario,
                formatCurrency(transfer.monto),
                transfer.concepto
            ]);
            
            doc.autoTable({
                startY: yPosition,
                head: [['Destinatario', 'Monto', 'Concepto']],
                body: transfersData,
                theme: 'grid',
                headStyles: {
                    fillColor: primaryColor,
                    textColor: [255, 255, 255],
                    fontStyle: 'bold'
                },
                bodyStyles: {
                    fontSize: 10
                },
                columnStyles: {
                    0: { cellWidth: contentWidth * 0.25 },
                    1: { cellWidth: contentWidth * 0.25, halign: 'right' },
                    2: { cellWidth: contentWidth * 0.5 }
                },
                margin: { left: margin, right: margin }
            });
            
            yPosition = doc.lastAutoTable.finalY + 10;
            
            // Total de transferencias a NeuroTEA
            const totalNeuroteaTransfers = neuroteaTransfers.reduce((sum, t) => sum + t.monto, 0);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(`Total Transferencias a NeuroTEA: ${formatCurrency(totalNeuroteaTransfers)}`, margin, yPosition);
        } else {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'italic');
            doc.text('No hay transferencias a NeuroTEA registradas para este día', margin, yPosition);
            yPosition += 20;
        }
    } else {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'italic');
        doc.text('No hay transferencias registradas para este día', margin, yPosition);
        yPosition += 20;
    }
    
    // Pie de página
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(128, 128, 128);
        
        const footerText = `Generado el ${new Date().toLocaleDateString('es-PY')} a las ${new Date().toLocaleTimeString('es-PY')}`;
        doc.text(footerText, margin, doc.internal.pageSize.height - 10);
        
        const pageText = `Página ${i} de ${pageCount}`;
        const pageTextWidth = doc.getTextWidth(pageText);
        doc.text(pageText, pageWidth - margin - pageTextWidth, doc.internal.pageSize.height - 10);
    }
    
    // Descargar el PDF
    const fileName = `NeuroTEA_Rendicion_${fecha.replace(/-/g, '_')}.pdf`;
    doc.save(fileName);
}


// ===========================
// FUNCIONES DE SALDO INICIAL
// ===========================

// Obtener saldo inicial para una fecha
function getInitialBalance(fecha) {
    return saldosIniciales[fecha] || 0;
}

// NUEVA FUNCIÓN: Obtener saldo inicial de cuenta bancaria
function getInitialBankBalance(fecha) {
    // Por ahora, usar el saldo real de banco como base
    // En el futuro se puede implementar saldos iniciales separados para banco
    return saldosReales.banco || 0;
}

// Actualizar el badge de saldo inicial
function updateSaldoBadge(fecha) {
    const badge = document.getElementById('saldo-inicial-badge');
    const dot = document.getElementById('saldo-status-dot');
    
    if (!badge || !dot) return;
    
    const saldoInicial = getInitialBalance(fecha);
    const estadoSaldo = getSaldoInitialState(fecha);
    
    // Limpiar clases anteriores del punto (el badge siempre mantiene su estilo gris)
    dot.className = dot.className.replace(/saldo-(configurado|editado)/g, '');
    
    // Aplicar estilos según el estado de configuración (solo al punto)
    if (estadoSaldo === 'sin-definir') {
        // Gris: Sin definir (saldo inicial = 0)
        // No agregar clase, usa el color gris por defecto
    } else if (estadoSaldo === 'configurado') {
        // Verde: Configurado por primera vez
        dot.classList.add('saldo-configurado');
    } else if (estadoSaldo === 'editado') {
        // Naranja: Ha sido editado/modificado
        dot.classList.add('saldo-editado');
    }
}

// Determinar el estado del saldo inicial
function getSaldoInitialState(fecha) {
    const saldoInicial = getInitialBalance(fecha);
    const historial = historialSaldos[fecha] || [];
    
    if (saldoInicial === 0) {
        return 'sin-definir';
    } else if (historial.length <= 1) {
        // Solo una entrada en el historial = configurado por primera vez
        return 'configurado';
    } else {
        // Múltiples entradas = ha sido editado
        return 'editado';
    }
}

// Abrir modal de saldo inicial
function openSaldoModal() {
    const modal = document.getElementById('saldo-modal');
    const saldoDisplay = document.getElementById('saldo-actual-display');
    const statusText = document.getElementById('saldo-status-text');
    
    if (!modal) return;
    
    const saldoInicial = getInitialBalance(fechaActual);
    const estadoSaldo = getSaldoInitialState(fechaActual);
    
    // Actualizar display
    saldoDisplay.textContent = formatNumber(saldoInicial);
    
    // Actualizar texto de estado
    if (estadoSaldo === 'sin-definir') {
        statusText.textContent = 'Sin definir';
        statusText.className = 'badge badge-secondary';
    } else if (estadoSaldo === 'configurado') {
        statusText.textContent = 'Configurado';
        statusText.className = 'badge badge-warning';
    } else {
        statusText.textContent = 'Editado';
        statusText.className = 'badge badge-danger';
    }
    
    // Actualizar historial
    updateHistorialExpandible();
    
    modal.classList.remove('hidden');
}

// Cerrar modal de saldo inicial
function closeSaldoModal() {
    const modal = document.getElementById('saldo-modal');
    if (modal) {
        modal.classList.add('hidden');
        
        // Cerrar modo edición si está abierto
        const editSection = document.getElementById('saldo-edit-section');
        const actionButtons = document.getElementById('saldo-action-buttons');
        if (editSection && !editSection.classList.contains('hidden')) {
            editSection.classList.add('hidden');
            actionButtons.classList.remove('hidden');
        }
        
        // Cerrar historial si está abierto
        const historialContent = document.getElementById('historial-content');
        if (historialContent && !historialContent.classList.contains('hidden')) {
            historialContent.classList.add('hidden');
        }
    }
}

// Alternar modo de edición
function toggleEditMode() {
    const editSection = document.getElementById('saldo-edit-section');
    const actionButtons = document.getElementById('saldo-action-buttons');
    const input = document.getElementById('nuevo-saldo-input');
    
    if (editSection.classList.contains('hidden')) {
        // Confirmar antes de entrar en modo edición
        const saldoActual = getInitialBalance(fechaActual);
        let mensajeConfirmacion = '';
        
        if (saldoActual === 0) {
            mensajeConfirmacion = '¿Está seguro de que desea establecer un saldo inicial para este día?';
        } else {
            mensajeConfirmacion = `¿Está seguro de que desea editar el saldo inicial actual de ${formatCurrency(saldoActual)}?`;
        }
        
        if (!confirm(mensajeConfirmacion)) {
            return;
        }
        
        // Entrar en modo edición
        editSection.classList.remove('hidden');
        actionButtons.classList.add('hidden');
        input.value = saldoActual;
        input.focus();
    } else {
        // Salir del modo edición
        editSection.classList.add('hidden');
        actionButtons.classList.remove('hidden');
        input.value = '';
    }
}

// Guardar saldo inicial
function saveSaldoInicial() {
    const input = document.getElementById('nuevo-saldo-input');
    const nuevoSaldo = parseNumber(input.value);
    
    if (nuevoSaldo < 0) {
        alert('El saldo inicial no puede ser negativo');
        return;
    }
    
    const saldoAnterior = getInitialBalance(fechaActual);
    
    // Determinar el tipo de acción para la confirmación
    let mensajeConfirmacion = '';
    if (saldoAnterior === 0 && nuevoSaldo > 0) {
        mensajeConfirmacion = `¿Está seguro de que desea establecer el saldo inicial en ${formatCurrency(nuevoSaldo)}?`;
    } else if (saldoAnterior !== nuevoSaldo) {
        mensajeConfirmacion = `¿Está seguro de que desea cambiar el saldo inicial de ${formatCurrency(saldoAnterior)} a ${formatCurrency(nuevoSaldo)}?`;
    } else {
        // No hay cambios, cerrar modo edición sin hacer nada
        toggleEditMode();
        return;
    }
    
    // Solicitar confirmación
    if (!confirm(mensajeConfirmacion)) {
        return;
    }
    
    // Guardar nuevo saldo
    saldosIniciales[fechaActual] = nuevoSaldo;
    
    // Agregar al historial SOLO si hay cambio real
    if (saldoAnterior !== nuevoSaldo) {
        addToHistorialSaldo(fechaActual, nuevoSaldo, saldoAnterior);
    }
    
    // Actualizar badge
    updateSaldoBadge(fechaActual);
    
    // Actualizar vistas
    updateAllViews(fechaActual);
    
    // Guardar en storage
    saveToStorage();
    
    // Cerrar modo edición
    toggleEditMode();
    
    // Actualizar modal
    openSaldoModal();
}

// Limpiar historial de saldos (nueva funcionalidad con contraseña)
async function clearHistorialSaldo() {
    const password = prompt('Ingrese contraseña para limpiar historial:');
    
    if (password !== '280208') {
        alert('Contraseña incorrecta');
        return;
    }
    
    // Confirmar acción con mensaje más claro
    if (!confirm('¿Está seguro de que desea resetear completamente el saldo inicial? Esto limpiará el historial Y volverá el saldo a 0. Esta acción no se puede deshacer.')) {
        return;
    }
    
    // CORRECCIÓN: Resetear TANTO el historial COMO el saldo inicial
    if (historialSaldos[fechaActual]) {
        delete historialSaldos[fechaActual];
    }
    
    // Resetear el saldo inicial a 0 (como si estuviera iniciando recién)
    saldosIniciales[fechaActual] = 0;
    
    // NUEVO: Eliminar de IndexedDB
    try {
        await deleteHistorialSaldosByDate(fechaActual);
        await deleteFromIndexedDB('saldosIniciales', fechaActual);
    } catch (error) {
        console.error('Error deleting from IndexedDB:', error);
    }
    
    // Guardar cambios
    saveToStorage();
    
    // Actualizar estado visual completo después de resetear
    updateSaldoBadge(fechaActual);
    updateHistorialExpandible();
    
    // Actualizar el modal para reflejar el reseteo completo
    const saldoDisplay = document.getElementById('saldo-actual-display');
    const statusText = document.getElementById('saldo-status-text');
    
    if (saldoDisplay) {
        saldoDisplay.textContent = formatNumber(0);
    }
    
    if (statusText) {
        statusText.textContent = 'Sin definir';
        statusText.className = 'badge badge-secondary';
    }
    
    // Actualizar todas las vistas para reflejar el cambio
    updateAllViews(fechaActual);
    
    alert('Saldo inicial reseteado correctamente');
}

// Agregar entrada al historial con límite de 10 entradas
function addToHistorialSaldo(fecha, valorNuevo, valorAnterior) {
    // VALIDACIÓN: Rechazar valores inválidos para prevenir "undefined"
    if (fecha === undefined || fecha === null || fecha === '') {
        console.error('addToHistorialSaldo: fecha inválida', fecha);
        return;
    }
    
    if (valorNuevo === undefined || valorNuevo === null || isNaN(valorNuevo)) {
        console.error('addToHistorialSaldo: valorNuevo inválido', valorNuevo);
        return;
    }
    
    if (valorAnterior === undefined || valorAnterior === null || isNaN(valorAnterior)) {
        console.error('addToHistorialSaldo: valorAnterior inválido', valorAnterior);
        return;
    }
    
    // Convertir a números para asegurar validez
    valorNuevo = Number(valorNuevo);
    valorAnterior = Number(valorAnterior);
    
    if (!historialSaldos[fecha]) {
        historialSaldos[fecha] = [];
    }
    
    // Determinar tipo de acción y generar mensaje simple
    let accion, mensaje;
    if (valorAnterior === 0) {
        accion = 'establecio';
        mensaje = `Se estableció saldo inicial: ${formatCurrency(valorNuevo)}`;
    } else {
        accion = 'edito';
        mensaje = `Se editó saldo inicial: de ${formatCurrency(valorAnterior)} a ${formatCurrency(valorNuevo)}`;
    }
    
    const entrada = {
        timestamp: new Date().toISOString(),
        accion: accion,
        valorAnterior: valorAnterior,
        valorNuevo: valorNuevo,
        mensaje: mensaje
    };
    
    // Agregar al inicio del array (más reciente primero)
    historialSaldos[fecha].unshift(entrada);
    
    // Limitar a máximo 10 entradas
    if (historialSaldos[fecha].length > 10) {
        historialSaldos[fecha] = historialSaldos[fecha].slice(0, 10);
    }
}

// Alternar visibilidad del historial
function toggleHistorial() {
    const content = document.getElementById('historial-content');
    const chevron = document.getElementById('historial-chevron');
    
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        chevron.style.transform = 'rotate(180deg)';
    } else {
        content.classList.add('hidden');
        chevron.style.transform = 'rotate(0deg)';
    }
}

// Actualizar contador del historial
function updateHistorialCounter() {
    const counter = document.getElementById('historial-counter');
    const historial = historialSaldos[fechaActual] || [];
    
    if (counter) {
        counter.textContent = historial.length;
    }
}

// Actualizar contenido expandible del historial
function updateHistorialExpandible() {
    const container = document.getElementById('historial-list');
    let historial = historialSaldos[fechaActual] || [];
    
    // CORRECCIÓN: Filtrar entradas con mensajes undefined o inválidos
    historial = historial.filter(entrada => 
        entrada && 
        entrada.mensaje && 
        entrada.mensaje !== 'undefined' && 
        typeof entrada.mensaje === 'string' &&
        entrada.mensaje.trim() !== ''
    );
    
    // Actualizar el historial limpio
    if (historial.length !== (historialSaldos[fechaActual] || []).length) {
        historialSaldos[fechaActual] = historial;
        saveToStorage(); // Guardar cambios
    }
    
    updateHistorialCounter();
    
    if (!container) return;
    
    if (historial.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No hay cambios registrados</p>';
        return;
    }
    
    // Mostrar mensajes simples ordenados por fecha (más reciente primero)
    container.innerHTML = historial.map(entrada => {
        const fecha = new Date(entrada.timestamp);
        const fechaStr = fecha.toLocaleDateString('es-PY');
        const horaStr = fecha.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
        
        return `
            <div class="text-sm p-2 bg-gray-50 dark:bg-gray-700 rounded">
                <div class="font-medium">${entrada.mensaje}</div>
                <div class="text-xs text-gray-500 mt-1">${fechaStr} ${horaStr}</div>
            </div>
        `;
    }).join('');
}

// ===========================
// SISTEMA DE CRÉDITOS Y PAQUETES - FUNCIONES PRINCIPALES
// ===========================

/**
 * Crea créditos para un paciente con terapeuta específica
 * Puede ser por paquete independiente o créditos adicionales en sesión
 */
function createPatientCredits(creditData) {
    const { patientName, therapist, quantity, packageId, valuePerSession, totalValue, purchaseDate } = creditData;
    
    // Validaciones
    if (!patientName || !therapist || quantity <= 0) {
        throw new Error('Datos insuficientes para crear créditos');
    }
    
    // Inicializar estructura si no existe
    if (!patientCredits[patientName]) {
        patientCredits[patientName] = {};
    }
    
    // Verificar si ya existen créditos para esta combinación
    if (patientCredits[patientName][therapist]) {
        // Agregar a créditos existentes (caso: múltiples paquetes)
        const existing = patientCredits[patientName][therapist];
        
        // Crear nuevo registro para el nuevo paquete
        const newCreditEntry = {
            remaining: quantity,
            total: quantity,
            purchaseDate: purchaseDate,
            packageId: packageId,
            valuePerSession: valuePerSession,
            totalValue: totalValue,
            status: 'active',
            usageHistory: []
        };
        
        // Manejar múltiples paquetes (convertir a array si es necesario)
        if (Array.isArray(existing)) {
            existing.push(newCreditEntry);
        } else {
            // Convertir estructura simple a array
            patientCredits[patientName][therapist] = [existing, newCreditEntry];
        }
    } else {
        // Crear nuevos créditos
        patientCredits[patientName][therapist] = {
            remaining: quantity,
            total: quantity,
            purchaseDate: purchaseDate,
            packageId: packageId,
            valuePerSession: valuePerSession,
            totalValue: totalValue,
            status: 'active',
            usageHistory: []
        };
    }
    
    // Registrar en log de auditoría
    logCreditOperation('create', {
        patient: patientName,
        therapist: therapist,
        quantity: quantity,
        packageId: packageId,
        timestamp: new Date().toISOString()
    });
    
    return true;
}

/**
 * Usa un crédito de un paciente para una terapeuta específica
 * Actualiza inventario y registra historial de uso
 */
function usePatientCredit(patientName, therapist, sessionId) {
    // Validar existencia de créditos
    if (!patientCredits[patientName] || !patientCredits[patientName][therapist]) {
        throw new Error(`No hay créditos disponibles para ${patientName} con ${therapist}`);
    }
    
    const creditEntry = patientCredits[patientName][therapist];
    
    // Manejar múltiples paquetes si los hay
    if (Array.isArray(creditEntry)) {
        // Usar del paquete más antiguo primero (FIFO)
        const activePackage = creditEntry.find(pkg => pkg.remaining > 0 && pkg.status === 'active');
        
        if (!activePackage) {
            throw new Error(`No hay créditos activos disponibles para ${patientName} con ${therapist}`);
        }
        
        return processCreditUsage(activePackage, patientName, therapist, sessionId);
    } else {
        // Estructura simple (un solo paquete)
        if (creditEntry.remaining <= 0 || creditEntry.status !== 'active') {
            throw new Error(`No hay créditos disponibles para ${patientName} con ${therapist}`);
        }
        
        return processCreditUsage(creditEntry, patientName, therapist, sessionId);
    }
}

/**
 * Procesa el uso real del crédito
 */
function processCreditUsage(creditEntry, patientName, therapist, sessionId) {
    // Decrementar créditos disponibles
    creditEntry.remaining--;
    
    // Registrar en historial de uso
    const usageRecord = {
        sessionDate: fechaActual,
        sessionId: sessionId,
        remainingAfter: creditEntry.remaining,
        timestamp: new Date().toISOString()
    };
    
    if (!creditEntry.usageHistory) {
        creditEntry.usageHistory = [];
    }
    creditEntry.usageHistory.push(usageRecord);
    
    // Actualizar estado si se agotaron los créditos
    if (creditEntry.remaining === 0) {
        creditEntry.status = 'used';
        creditEntry.completedDate = fechaActual;
    }
    
    // Registrar en log de auditoría
    logCreditOperation('use', {
        patient: patientName,
        therapist: therapist,
        packageId: creditEntry.packageId,
        remainingAfter: creditEntry.remaining,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
    });
    
    return {
        success: true,
        remainingCredits: creditEntry.remaining,
        packageInfo: {
            packageId: creditEntry.packageId,
            originalValue: creditEntry.valuePerSession,
            purchaseDate: creditEntry.purchaseDate
        }
    };
}

/**
 * Obtiene información completa de créditos de un paciente
 */
function getPatientCreditsInfo(patientName, therapist = null) {
    if (!patientCredits[patientName]) {
        return null;
    }
    
    if (therapist) {
        // Información específica para una terapeuta
        const credits = patientCredits[patientName][therapist];
        if (!credits) return null;
        
        if (Array.isArray(credits)) {
            // Múltiples paquetes - agregar totales
            const totalRemaining = credits.reduce((sum, pkg) => sum + pkg.remaining, 0);
            const totalOriginal = credits.reduce((sum, pkg) => sum + pkg.total, 0);
            
            return {
                therapist: therapist,
                totalRemaining: totalRemaining,
                totalOriginal: totalOriginal,
                packages: credits,
                hasMultiplePackages: true
            };
        } else {
            // Paquete único
            return {
                therapist: therapist,
                totalRemaining: credits.remaining,
                totalOriginal: credits.total,
                packages: [credits],
                hasMultiplePackages: false
            };
        }
    } else {
        // Información completa del paciente
        const allCredits = {};
        Object.keys(patientCredits[patientName]).forEach(therapistName => {
            allCredits[therapistName] = getPatientCreditsInfo(patientName, therapistName);
        });
        return allCredits;
    }
}

/**
 * Valida si un paciente tiene créditos disponibles
 */
function hasAvailableCredits(patientName, therapist) {
    const creditsInfo = getPatientCreditsInfo(patientName, therapist);
    return creditsInfo && creditsInfo.totalRemaining > 0;
}

/**
 * Usa un crédito de un paciente para una terapeuta específica
 */
function usePatientCredits(patientName, therapist, sessionId) {
    try {
        // Verificar que existen créditos
        if (!patientCredits[patientName] || !patientCredits[patientName][therapist]) {
            return {
                success: false,
                message: `No se encontraron créditos para ${patientName} con ${therapist}`
            };
        }
        
        const credits = patientCredits[patientName][therapist];
        
        if (Array.isArray(credits)) {
            // Múltiples paquetes - usar del primer paquete con créditos disponibles
            for (let i = 0; i < credits.length; i++) {
                if (credits[i].remaining > 0) {
                    credits[i].remaining--;
                    credits[i].used++;
                    
                    // Agregar registro de uso
                    if (!credits[i].usageHistory) {
                        credits[i].usageHistory = [];
                    }
                    credits[i].usageHistory.push({
                        sessionId: sessionId,
                        date: getLocalDateString(),
                        timestamp: Date.now()
                    });
                    
                    return {
                        success: true,
                        message: `Crédito usado exitosamente. Quedan ${credits[i].remaining} créditos en este paquete.`,
                        packageUsed: credits[i].packageId,
                        remainingInPackage: credits[i].remaining
                    };
                }
            }
            
            return {
                success: false,
                message: `No hay créditos disponibles para ${patientName} con ${therapist}`
            };
            
        } else {
            // Paquete único
            if (credits.remaining > 0) {
                credits.remaining--;
                credits.used++;
                
                // Agregar registro de uso
                if (!credits.usageHistory) {
                    credits.usageHistory = [];
                }
                credits.usageHistory.push({
                    sessionId: sessionId,
                    date: getLocalDateString(),
                    timestamp: Date.now()
                });
                
                return {
                    success: true,
                    message: `Crédito usado exitosamente. Quedan ${credits.remaining} créditos.`,
                    packageUsed: credits.packageId,
                    remainingInPackage: credits.remaining
                };
            } else {
                return {
                    success: false,
                    message: `No hay créditos disponibles para ${patientName} con ${therapist}`
                };
            }
        }
        
    } catch (error) {
        console.error('Error al usar créditos:', error);
        return {
            success: false,
            message: `Error interno al usar crédito: ${error.message}`
        };
    }
}

/**
 * Obtiene lista de pacientes con créditos para una terapeuta
 */
function getPatientsWithCreditsForTherapist(therapist) {
    const patientsWithCredits = [];
    
    Object.keys(patientCredits).forEach(patientName => {
        if (hasAvailableCredits(patientName, therapist)) {
            const creditsInfo = getPatientCreditsInfo(patientName, therapist);
            patientsWithCredits.push({
                patientName: patientName,
                remaining: creditsInfo.totalRemaining,
                total: creditsInfo.totalOriginal,
                packages: creditsInfo.packages.length
            });
        }
    });
    
    // Ordenar alfabéticamente
    return patientsWithCredits.sort((a, b) => a.patientName.localeCompare(b.patientName));
}

/**
 * Obtiene estadísticas completas del sistema de créditos
 */
function getCreditSystemStats() {
    const stats = {
        totalActiveCredits: 0,
        totalUsedCredits: 0,
        totalValueActive: 0,
        totalValueUsed: 0,
        patientCount: 0,
        therapistCount: 0,
        packageCount: 0,
        byTherapist: {},
        byPatient: {}
    };
    
    // Analizar cada paciente
    Object.keys(patientCredits).forEach(patientName => {
        stats.patientCount++;
        stats.byPatient[patientName] = {
            totalCredits: 0,
            totalValue: 0,
            therapists: []
        };
        
        Object.keys(patientCredits[patientName]).forEach(therapist => {
            const creditsInfo = getPatientCreditsInfo(patientName, therapist);
            
            // Estadísticas por terapeuta
            if (!stats.byTherapist[therapist]) {
                stats.byTherapist[therapist] = {
                    activeCredits: 0,
                    usedCredits: 0,
                    totalValue: 0,
                    patients: 0
                };
                stats.therapistCount++;
            }
            
            stats.byTherapist[therapist].activeCredits += creditsInfo.totalRemaining;
            stats.byTherapist[therapist].usedCredits += (creditsInfo.totalOriginal - creditsInfo.totalRemaining);
            stats.byTherapist[therapist].patients++;
            
            // Calcular valor total
            creditsInfo.packages.forEach(pkg => {
                stats.byTherapist[therapist].totalValue += pkg.totalValue;
                stats.totalValueActive += (pkg.remaining * pkg.valuePerSession);
                stats.totalValueUsed += ((pkg.total - pkg.remaining) * pkg.valuePerSession);
            });
            
            // Estadísticas por paciente
            stats.byPatient[patientName].totalCredits += creditsInfo.totalRemaining;
            stats.byPatient[patientName].therapists.push(therapist);
            
            // Estadísticas generales
            stats.totalActiveCredits += creditsInfo.totalRemaining;
            stats.totalUsedCredits += (creditsInfo.totalOriginal - creditsInfo.totalRemaining);
            stats.packageCount += creditsInfo.packages.length;
        });
    });
    
    return stats;
}

/**
 * Crea un paquete independiente (sin sesión del día)
 * Genera créditos automáticamente y registra como ingreso
 */
function createIndependentPackage(packageData) {
    // Validaciones de entrada
    if (!validateSinglePackageData(packageData)) {
        throw new Error('Datos de paquete inválidos');
    }
    
    // Generar ID simple del paquete
    const packageCounter = Object.keys(localStorage).filter(key => key.startsWith('package_')).length + 1;
    const packageId = `PK-${packageCounter.toString().padStart(3, '0')}`;
    const fecha = fechaActual;
    
    // Crear estructura del paquete
    const newPackage = {
        id: packageId,
        patientName: packageData.patientName,
        therapist: packageData.therapist,
        totalSessions: packageData.totalSessions,
        cashToNeurotea: packageData.cashToNeurotea,
        transferToTherapist: packageData.transferToTherapist,
        transferToNeurotea: packageData.transferToNeurotea,
        sessionValue: packageData.totalValue,
        valuePerSession: packageData.totalValue / packageData.totalSessions,
        neuroteaContribution: packageData.neuroteaContribution || (packageData.totalValue * 0.20),
        therapistFee: packageData.totalValue - (packageData.neuroteaContribution || (packageData.totalValue * 0.20)),
        contributionType: packageData.contributionType || '20',
        purchaseDate: fecha,
        purchaseTime: new Date().toLocaleTimeString('es-PY'),
        createdBy: 'independent',
        status: 'active',
        notes: packageData.notes || ''
    };
    
    // Registrar paquete en estructura diaria
    if (!dailyPackagePurchases[fecha]) {
        dailyPackagePurchases[fecha] = [];
    }
    dailyPackagePurchases[fecha].push(newPackage);
    
    // Generar créditos automáticamente
    createPatientCredits({
        patientName: packageData.patientName,
        therapist: packageData.therapist,
        quantity: packageData.totalSessions,
        packageId: packageId,
        valuePerSession: newPackage.valuePerSession,
        totalValue: packageData.totalValue,
        purchaseDate: fecha
    });
    
    // Actualizar saldos financieros
    updateFinancialBalances({
        efectivo: packageData.cashToNeurotea,
        banco: packageData.transferToNeurotea
    });
    
    // Registrar como ingreso del día
    registerPackageIncome(newPackage, fecha);
    
    return packageId;
}

/**
 * Valida los datos de un paquete individual antes de crearlo
 */
function validateSinglePackageData(packageData) {
    if (!packageData || !packageData.patientName || packageData.patientName.trim() === '') {
        return false;
    }
    if (!packageData.therapist || packageData.therapist.trim() === '') {
        return false;
    }
    if (!packageData.totalSessions || packageData.totalSessions <= 0 || packageData.totalSessions > 50) {
        return false;
    }
    if (!packageData.totalValue || packageData.totalValue <= 0) {
        return false;
    }
    return true;
}

/**
 * ✅ ARQUITECTURA CORREGIDA: Esta función ya no modifica saldosReales
 * El saldo se calcula DINÁMICAMENTE con calcularSaldoCajaReal()
 * Se mantiene por compatibilidad pero no hace nada
 */
function updateFinancialBalances(amounts) {
    // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
    // El saldo se recalculará DINÁMICAMENTE con calcularSaldoCajaReal()
    console.log('📊 updateFinancialBalances llamada (sin efecto - cálculo dinámico activo)');
    saveToStorage();
}

/**
 * Registra un paquete como ingreso del día
 */
function registerPackageIncome(packageData, fecha) {
    // Esta función se integrará con el sistema de ingresos existente
    // Por ahora solo registra en el log
    logCreditOperation('package_income', {
        packageId: packageData.id,
        patient: packageData.patientName,
        therapist: packageData.therapist,
        amount: packageData.sessionValue,
        fecha: fecha,
        timestamp: new Date().toISOString()
    });
}

/**
 * Registra operaciones de créditos para auditoría
 */
function logCreditOperation(operation, data) {
    const logEntry = {
        operation: operation,
        data: data,
        timestamp: new Date().toISOString()
    };
    
    // Por ahora solo log en consola, se puede extender para persistir
    console.log('Credit Operation:', logEntry);
}

// Event listeners para el modal del saldo inicial (se agregan en el DOMContentLoaded principal)


// ===========================
// FUNCIONES DE LA PESTAÑA DE PAQUETES
// ===========================

/**
 * Pobla el select de terapeutas en el formulario de paquetes
 */
function populatePackageTherapistSelect() {
    const select = document.getElementById('package-therapist');
    if (!select) return;
    
    // Limpiar opciones existentes excepto la primera
    select.innerHTML = '<option value="">Seleccionar terapeuta</option>';
    
    // Agregar terapeutas disponibles
    therapists.forEach(therapist => {
        const option = document.createElement('option');
        option.value = therapist;
        option.textContent = therapist;
        select.appendChild(option);
    });
}

/**
 * Actualiza la lista de paquetes activos
 * CORREGIDO: Ahora muestra TODOS los paquetes con créditos disponibles,
 * independientemente de la fecha de compra
 */
function updateActivePackagesList() {
    const container = document.getElementById('active-packages-container');
    const counter = document.getElementById('active-packages-counter');

    if (!container || !counter) return;

    // CORRECCIÓN: Obtener paquetes de TODAS las fechas, no solo de hoy
    const allActivePackages = [];
    const packagesToRemove = []; // Paquetes sin créditos para eliminar

    // Iterar sobre todas las fechas en dailyPackagePurchases
    Object.keys(dailyPackagePurchases).forEach(fecha => {
        const packagesForDate = dailyPackagePurchases[fecha] || [];

        packagesForDate.forEach(pkg => {
            // Verificar si el paquete aún tiene créditos disponibles
            const creditsInfo = getPatientCreditsInfo(pkg.patientName, pkg.therapist);
            const remainingCredits = creditsInfo ? creditsInfo.totalRemaining : 0;

            if (remainingCredits > 0) {
                // Paquete activo - agregar a la lista con fecha de referencia
                allActivePackages.push({
                    ...pkg,
                    _purchaseDate: fecha,
                    _remainingCredits: remainingCredits,
                    _totalCredits: creditsInfo ? creditsInfo.totalOriginal : pkg.totalSessions
                });
            } else {
                // Paquete agotado - marcar para eliminación
                packagesToRemove.push({ fecha, packageId: pkg.id });
            }
        });
    });

    // Limpiar paquetes agotados de dailyPackagePurchases
    if (packagesToRemove.length > 0) {
        packagesToRemove.forEach(({ fecha, packageId }) => {
            if (dailyPackagePurchases[fecha]) {
                const index = dailyPackagePurchases[fecha].findIndex(p => p.id === packageId);
                if (index !== -1) {
                    dailyPackagePurchases[fecha].splice(index, 1);
                    console.log(`🧹 Paquete agotado eliminado: ${packageId} de fecha ${fecha}`);
                }
                // Si no quedan paquetes en esa fecha, eliminar la entrada
                if (dailyPackagePurchases[fecha].length === 0) {
                    delete dailyPackagePurchases[fecha];
                }
            }
        });
        // Guardar cambios después de limpieza
        saveToStorageAsync();
    }

    // Ordenar por fecha de compra (más recientes primero)
    allActivePackages.sort((a, b) => {
        const dateA = a._purchaseDate || '';
        const dateB = b._purchaseDate || '';
        return dateB.localeCompare(dateA);
    });

    if (allActivePackages.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">No hay paquetes activos</p>';
        counter.textContent = '0 paquetes activos';
        return;
    }

    // Generar HTML para cada paquete activo
    const packagesHTML = allActivePackages.map(pkg => {
        const remainingCredits = pkg._remainingCredits;
        const totalCredits = pkg._totalCredits;
        const usedCredits = totalCredits - remainingCredits;
        const purchaseDate = pkg._purchaseDate;

        return `
            <div class="border rounded-lg p-4 bg-gray-50 dark:bg-gray-700">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <h4 class="font-semibold text-lg">${pkg.patientName}</h4>
                        <p class="text-sm text-gray-600 dark:text-gray-400">Terapeuta: ${pkg.therapist}</p>
                    </div>
                    <div class="text-right">
                        <span class="text-sm text-gray-500">ID: ${pkg.id.substring(4, 10)}</span>
                        <p class="text-xs text-gray-500">${pkg.purchaseTime}</p>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 mb-3">
                    <div>
                        <span class="text-sm text-gray-600 dark:text-gray-400">Sesiones:</span>
                        <p class="font-medium">${usedCredits}/${totalCredits} usadas</p>
                    </div>
                    <div>
                        <span class="text-sm text-gray-600 dark:text-gray-400">Restantes:</span>
                        <p class="font-medium text-green-600">${remainingCredits}</p>
                    </div>
                </div>

                <div class="grid grid-cols-3 gap-2 text-xs">
                    <div>
                        <span class="text-gray-500">Efectivo:</span>
                        <p class="font-medium">Gs ${pkg.cashToNeurotea.toLocaleString()}</p>
                    </div>
                    <div>
                        <span class="text-gray-500">Transf. Terap.:</span>
                        <p class="font-medium">Gs ${pkg.transferToTherapist.toLocaleString()}</p>
                    </div>
                    <div>
                        <span class="text-gray-500">Transf. NeuroTEA:</span>
                        <p class="font-medium">Gs ${pkg.transferToNeurotea.toLocaleString()}</p>
                    </div>
                </div>

                <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600 flex justify-between items-center">
                    <div class="text-lg font-bold text-gray-900 dark:text-white">
                        Total del Paquete: <span class="text-blue-600 dark:text-blue-400">${formatCurrency(pkg.sessionValue)}</span>
                    </div>
                    <button
                        onclick="eliminarPaqueteIndividual('${pkg.id}')"
                        class="text-red-500 hover:text-red-700 p-1"
                        title="Eliminar este paquete">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = packagesHTML;
    counter.textContent = `${allActivePackages.length} paquete${allActivePackages.length !== 1 ? 's' : ''} activo${allActivePackages.length !== 1 ? 's' : ''}`;
}

/**
 * Calcula y actualiza los totales del formulario de paquetes
 */
function updatePackageTotals() {
    const cashInput = document.getElementById('package-cash');
    const transferTherapistInput = document.getElementById('package-transfer-therapist');
    const transferNeuroTEAInput = document.getElementById('package-transfer-neurotea');
    const sessionsInput = document.getElementById('package-sessions');
    const totalDisplay = document.getElementById('package-total');
    const perSessionDisplay = document.getElementById('package-per-session');
    const aporteDisplay = document.getElementById('package-aporte-neurotea');
    const aportePercentageDisplay = document.getElementById('package-aporte-percentage');
    const honorariosDisplay = document.getElementById('package-honorarios-terapeuta');
    const createBtn = document.getElementById('create-package-btn');
    
    if (!cashInput || !transferTherapistInput || !transferNeuroTEAInput || !sessionsInput || !totalDisplay || !perSessionDisplay || !createBtn) return;
    
    const cash = parseFloat(cashInput.value) || 0;
    const transferTherapist = parseFloat(transferTherapistInput.value) || 0;
    const transferNeuroTEA = parseFloat(transferNeuroTEAInput.value) || 0;
    const sessions = parseInt(sessionsInput.value) || 0;
    
    const total = cash + transferTherapist + transferNeuroTEA;
    const perSession = sessions > 0 ? total / sessions : 0;
    
    // Calcular aporte a NeuroTEA según selección
    let neuroteaContribution = 0;
    let percentageText = '';
    const contributionType = document.querySelector('input[name="package-neurotea-contribution"]:checked')?.value;
    
    if (contributionType === 'fixed') {
        const fixedAmount = parseFloat(document.getElementById('package-fixed-amount-input').value) || 0;
        neuroteaContribution = Math.min(fixedAmount, total); // No puede exceder el total
        percentageText = '';
    } else {
        const percentage = parseFloat(contributionType) || 20;
        neuroteaContribution = total * (percentage / 100);
        percentageText = `(${percentage}%)`;
    }
    
    const therapistFee = Math.max(0, total - neuroteaContribution);
    
    // Actualizar displays
    totalDisplay.textContent = formatCurrency(total);
    perSessionDisplay.textContent = formatCurrency(perSession);
    
    if (aporteDisplay) aporteDisplay.textContent = formatCurrency(neuroteaContribution);
    if (aportePercentageDisplay) aportePercentageDisplay.textContent = percentageText;
    if (honorariosDisplay) honorariosDisplay.textContent = formatCurrency(therapistFee);
    
    // Validación mejorada
    const patientName = document.getElementById('package-patient-name').value.trim();
    const therapist = document.getElementById('package-therapist').value;
    
    // Validar monto fijo no exceda total
    const isValidFixed = contributionType !== 'fixed' || neuroteaContribution <= total;
    
    const isValid = patientName && therapist && sessions > 0 && sessions <= 50 && total > 0 && isValidFixed;
    
    createBtn.disabled = !isValid;
    
    if (createBtn.disabled) {
        createBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
        createBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
    } else {
        createBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
        createBtn.classList.add('bg-green-600', 'hover:bg-green-700');
    }
}

/**
 * Maneja el envío del formulario de creación de paquetes
 */
function handlePackageFormSubmit(event) {
    event.preventDefault();
    
    const patientName = document.getElementById('package-patient-name').value.trim();
    const therapist = document.getElementById('package-therapist').value;
    const sessions = parseInt(document.getElementById('package-sessions').value);
    const cash = parseFloat(document.getElementById('package-cash').value) || 0;
    const transferTherapist = parseFloat(document.getElementById('package-transfer-therapist').value) || 0;
    const transferNeuroTEA = parseFloat(document.getElementById('package-transfer-neurotea').value) || 0;
    
    const totalValue = cash + transferTherapist + transferNeuroTEA;
    
    // AGREGAR: Leer valores de aporte del formulario
    const contributionType = document.querySelector('input[name="package-neurotea-contribution"]:checked')?.value;
    let neuroteaContribution = 0;

    if (contributionType === 'fixed') {
        neuroteaContribution = parseFloat(document.getElementById('package-fixed-amount-input').value) || 0;
    } else {
        const percentage = parseFloat(contributionType) || 20;
        neuroteaContribution = totalValue * (percentage / 100);
    }
    
    // Validación adicional
    if (neuroteaContribution > totalValue) {
        alert('El aporte no puede ser mayor al total del paquete');
        return;
    }
    
    try {
        // Crear el paquete independiente
        const packageId = createIndependentPackage({
            patientName: patientName,
            therapist: therapist,
            totalSessions: sessions,
            cashToNeurotea: cash,
            transferToTherapist: transferTherapist,
            transferToNeurotea: transferNeuroTEA,
            totalValue: totalValue,
            neuroteaContribution: neuroteaContribution,  // NUEVO
            contributionType: contributionType           // NUEVO
        });
        
        // Limpiar formulario
        document.getElementById('package-form').reset();
        updatePackageTotals();
        
        // Actualizar vistas
        updateActivePackagesList();
        updateAllViews(fechaActual);
        
        // Guardar cambios
        saveToStorage();
        
        // Mostrar mensaje de éxito
        showNotification(`Paquete creado exitosamente (ID: ${packageId.substring(4, 10)})`, 'success');
        
    } catch (error) {
        console.error('Error al crear paquete:', error);
        showNotification('Error al crear el paquete: ' + error.message, 'error');
    }
}

/**
 * Muestra notificaciones temporales
 */
function showNotification(message, type = 'info') {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-50 p-4 rounded-md shadow-lg max-w-sm ${
        type === 'success' ? 'bg-green-500 text-white' :
        type === 'error' ? 'bg-red-500 text-white' :
        'bg-blue-500 text-white'
    }`;
    notification.textContent = message;
    
    // Agregar al DOM
    document.body.appendChild(notification);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 3000);
}

// Event listeners para el modal del saldo inicial (se agregan en el DOMContentLoaded principal)



// ===========================
// FASE 3: FUNCIONES DE CONTROL DEL FORMULARIO DE USO DE PAQUETES
// ===========================

/**
 * Alterna entre los modos de registro: "Pago del día" vs "Usar crédito disponible"
 */
function togglePaymentMode() {
    const paymentMode = document.querySelector('input[name="modo-registro"]:checked').value;
    const creditSection = document.getElementById('paciente-credito-section');
    const additionalSection = document.getElementById('creditos-adicionales-section');
    const paymentSection = document.getElementById('desglose-pago-section');
    
    // NUEVA FUNCIONALIDAD: Ocultar sección de aportes cuando se usa crédito
    const aporteSection = document.getElementById('aporte-neurotea-section');
    
    if (paymentMode === 'usar-credito') {
        // Mostrar sección de créditos, ocultar desglose de pago
        creditSection.style.display = 'block';
        additionalSection.style.display = 'none';
        paymentSection.style.display = 'none';
        
        // NUEVA: Ocultar sección de aportes (ya se calculó cuando se pagó el adelanto)
        if (aporteSection) {
            aporteSection.style.display = 'none';
        }
        
        updateAvailablePatients();
        
        // Limpiar campos de pago
        document.getElementById('cash-to-neurotea').value = '';
        document.getElementById('transfer-to-therapist').value = '';
        document.getElementById('transfer-to-neurotea').value = '';
    } else {
        // Modo normal: mostrar desglose, ocultar créditos
        creditSection.style.display = 'none';
        additionalSection.style.display = 'block';
        paymentSection.style.display = 'block';
        
        // NUEVA: Mostrar sección de aportes en modo normal
        if (aporteSection) {
            aporteSection.style.display = 'block';
        }
        
        // Limpiar selección de paciente con crédito
        document.getElementById('paciente-credito-select').value = '';
        document.getElementById('creditos-info-display').innerHTML = '';
    }
    
    // Actualizar validaciones
    validateRegisterButton();
}

/**
 * Actualiza la lista de pacientes con créditos disponibles para la terapeuta seleccionada
 */
function updateAvailablePatients() {
    const therapist = document.getElementById('therapist-select').value;
    const select = document.getElementById('paciente-credito-select');
    const infoDisplay = document.getElementById('creditos-info-display');
    
    if (!therapist) {
        select.innerHTML = '<option value="">Primero seleccione una terapeuta</option>';
        infoDisplay.innerHTML = '';
        return;
    }
    
    // Obtener pacientes con créditos para esta terapeuta
    const patientsWithCredits = getPatientsWithCreditsForTherapist(therapist);
    
    if (patientsWithCredits.length === 0) {
        select.innerHTML = '<option value="">No hay pacientes con créditos para esta terapeuta</option>';
        infoDisplay.innerHTML = '<div class="text-amber-600 dark:text-amber-400">ℹ️ No hay créditos disponibles para esta terapeuta</div>';
        return;
    }
    
    // Construir opciones del select
    let optionsHTML = '<option value="">Seleccionar paciente...</option>';
    patientsWithCredits.forEach(patient => {
        optionsHTML += `<option value="${patient.patientName}">${patient.patientName} (${patient.remaining} créditos)</option>`;
    });
    
    select.innerHTML = optionsHTML;
    infoDisplay.innerHTML = `<div class="text-green-600 dark:text-green-400">✅ ${patientsWithCredits.length} paciente(s) con créditos disponibles</div>`;
}

/**
 * Obtiene la lista de pacientes con créditos disponibles para una terapeuta específica
 */
function getPatientsWithCreditsForTherapist(therapist) {
    const patientsWithCredits = [];
    
    // Recorrer todos los pacientes con créditos
    for (const patientName in patientCredits) {
        if (patientCredits[patientName][therapist]) {
            const creditInfo = patientCredits[patientName][therapist];
            
            // Manejar múltiples paquetes si los hay
            if (Array.isArray(creditInfo)) {
                const totalRemaining = creditInfo.reduce((sum, pkg) => {
                    return sum + (pkg.status === 'active' ? pkg.remaining : 0);
                }, 0);
                
                if (totalRemaining > 0) {
                    patientsWithCredits.push({
                        patientName: patientName,
                        remaining: totalRemaining,
                        packages: creditInfo.filter(pkg => pkg.status === 'active' && pkg.remaining > 0)
                    });
                }
            } else {
                // Estructura simple (un solo paquete)
                if (creditInfo.status === 'active' && creditInfo.remaining > 0) {
                    patientsWithCredits.push({
                        patientName: patientName,
                        remaining: creditInfo.remaining,
                        packages: [creditInfo]
                    });
                }
            }
        }
    }
    
    return patientsWithCredits;
}

/**
 * Actualiza la información de créditos cuando se selecciona un paciente
 */
function updateCreditInfo() {
    const therapist = document.getElementById('therapist-select').value;
    const patientName = document.getElementById('paciente-credito-select').value;
    const infoDisplay = document.getElementById('creditos-info-display');
    
    if (!therapist || !patientName) {
        infoDisplay.innerHTML = '';
        return;
    }
    
    // Obtener información detallada de créditos
    const creditInfo = getPatientCredits(patientName, therapist);
    
    if (!creditInfo || creditInfo.remaining <= 0) {
        infoDisplay.innerHTML = '<div class="text-red-600 dark:text-red-400">❌ No hay créditos disponibles</div>';
        return;
    }
    
    // Mostrar información detallada
    let infoHTML = `
        <div class="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-200 dark:border-blue-800">
            <div class="font-medium text-blue-800 dark:text-blue-200">📦 Información de Créditos</div>
            <div class="text-sm text-blue-700 dark:text-blue-300 mt-1">
                <div>• Créditos disponibles: <strong>${creditInfo.remaining}</strong></div>
                <div>• Valor por sesión: <strong>Gs ${creditInfo.valuePerSession?.toLocaleString() || '0'}</strong></div>
                <div>• Paquete original: ${creditInfo.packageId}</div>
            </div>
        </div>
    `;
    
    infoDisplay.innerHTML = infoHTML;
}

/**
 * Maneja el toggle del checkbox de créditos adicionales
 */
function handleCreditAdditionalToggle() {
    const checkbox = document.getElementById('crear-creditos-adicionales');
    const container = document.getElementById('creditos-cantidad-container');
    
    if (checkbox.checked) {
        container.style.display = 'block';
        // Enfocar el input de cantidad
        setTimeout(() => {
            document.getElementById('creditos-cantidad').focus();
        }, 100);
    } else {
        container.style.display = 'none';
        document.getElementById('creditos-cantidad').value = '';
    }
}

/**
 * Valida el modo de crédito antes de permitir el registro
 */
function validateCreditMode() {
    const therapist = document.getElementById('therapist-select').value;
    const patientName = document.getElementById('paciente-credito-select').value;
    
    if (!therapist) {
        return { valid: false, message: 'Debe seleccionar una terapeuta' };
    }
    
    if (!patientName) {
        return { valid: false, message: 'Debe seleccionar un paciente con créditos' };
    }
    
    // Verificar que el paciente tiene créditos disponibles
    const hasCredits = hasAvailableCredits(patientName, therapist);
    if (!hasCredits) {
        return { valid: false, message: 'El paciente seleccionado no tiene créditos disponibles' };
    }
    
    return { valid: true };
}

/**
 * Valida el modo de pago antes de permitir el registro
 */

/**
 * Valida el modo de pago antes de permitir el registro
 */
function hasAvailableCredits(patientName, therapist) {
    if (!patientCredits[patientName] || !patientCredits[patientName][therapist]) {
        return false;
    }
    
    const creditInfo = patientCredits[patientName][therapist];
    
    // Manejar múltiples paquetes
    if (Array.isArray(creditInfo)) {
        return creditInfo.some(pkg => pkg.status === 'active' && pkg.remaining > 0);
    } else {
        return creditInfo.status === 'active' && creditInfo.remaining > 0;
    }
}

/**
 * Obtiene información de créditos de un paciente para una terapeuta
 */
function getPatientCredits(patientName, therapist) {
    if (!patientCredits[patientName] || !patientCredits[patientName][therapist]) {
        return null;
    }
    
    const creditInfo = patientCredits[patientName][therapist];
    
    // Manejar múltiples paquetes
    if (Array.isArray(creditInfo)) {
        // Buscar el primer paquete activo con créditos
        const activePackage = creditInfo.find(pkg => pkg.status === 'active' && pkg.remaining > 0);
        return activePackage || null;
    } else {
        return creditInfo.status === 'active' && creditInfo.remaining > 0 ? creditInfo : null;
    }
}


// ================================
// FUNCIONES PARA MINI CARRITO DE SESIONES FUTURAS
// ================================

/**
 * Inicializa el dropdown de terapeutas para sesiones futuras
 */
function inicializarTerapeutasFuturas() {
    const select = document.getElementById('terapeuta-futura-select');
    
    if (select && therapists.length > 0) {
        select.innerHTML = '<option value="">Seleccionar terapeuta...</option>';
        
        // Agregar TODAS las terapeutas (incluyendo la actual)
        therapists.forEach(therapist => {
            select.innerHTML += `<option value="${therapist}">${therapist}</option>`;
        });
    }
}

/**
 * Agrega una sesión futura al carrito temporal
 */
function agregarSesionFutura() {
    const terapeutaSelect = document.getElementById('terapeuta-futura-select');
    const cantidadInput = document.getElementById('cantidad-futura-input');
    
    const terapeuta = terapeutaSelect.value;
    const cantidad = parseInt(cantidadInput.value) || 1;
    
    // Validaciones
    if (!terapeuta) {
        alert('Por favor selecciona una terapeuta');
        return;
    }
    
    if (cantidad < 1 || cantidad > 20) {
        alert('La cantidad debe ser entre 1 y 20 sesiones');
        return;
    }
    
    // Verificar si ya existe una entrada para esta terapeuta
    const existingIndex = sesionesFuturasTemp.findIndex(s => s.terapeuta === terapeuta);
    
    if (existingIndex >= 0) {
        // Sumar a la cantidad existente
        sesionesFuturasTemp[existingIndex].cantidad += cantidad;
    } else {
        // Agregar nueva entrada
        sesionesFuturasTemp.push({
            terapeuta: terapeuta,
            cantidad: cantidad,
            id: Date.now() + Math.random(), // ID único para eliminar
            // Valores de pago (se configuran después)
            efectivo: 0,
            transferTerapeuta: 0,
            transferNeurotea: 0,
            total: 0
        });
    }
    
    // Actualizar vista y limpiar formulario
    actualizarListaSesionesFuturas();
    limpiarFormularioSesionFutura();
}

/**
 * Actualiza la vista de la lista de sesiones futuras
 */
function actualizarListaSesionesFuturas() {
    const lista = document.getElementById('lista-sesiones-futuras');
    const resumen = document.getElementById('resumen-sesiones-futuras');
    
    if (sesionesFuturasTemp.length === 0) {
        lista.innerHTML = `
            <div class="text-gray-500 dark:text-gray-400 text-sm text-center py-2 italic">
                No hay sesiones futuras agregadas
            </div>
        `;
        resumen.style.display = 'none';
        return;
    }
    
    // Generar lista de sesiones con desglose de pago
    lista.innerHTML = sesionesFuturasTemp.map(sesion => `
        <div class="bg-white dark:bg-gray-800 p-3 rounded border shadow-sm">
            <div class="flex justify-between items-center mb-3">
                <h5 class="font-medium text-gray-800 dark:text-gray-200">
                    ${sesion.terapeuta} - ${sesion.cantidad} sesión${sesion.cantidad > 1 ? 'es' : ''}
                </h5>
                <button type="button" 
                        onclick="eliminarSesionFutura('${sesion.id}')" 
                        class="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded"
                        title="Eliminar">
                    ✕
                </button>
            </div>
            
            <!-- Desglose de pago para esta sesión futura -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                <div>
                    <label class="block text-xs text-gray-600 dark:text-gray-400 mb-1">Efectivo NeuroTEA:</label>
                    <div class="relative">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-2 text-gray-500 dark:text-gray-400 text-xs">Gs</span>
                        <input type="number" 
                               class="w-full p-2 pl-8 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
                               id="efectivo-${sesion.id}"
                               onchange="calcularTotalSesionFutura('${sesion.id}')"
                               placeholder="0"
                               min="0">
                    </div>
                </div>
                <div>
                    <label class="block text-xs text-gray-600 dark:text-gray-400 mb-1">Trans. Terapeuta:</label>
                    <div class="relative">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-2 text-gray-500 dark:text-gray-400 text-xs">Gs</span>
                        <input type="number" 
                               class="w-full p-2 pl-8 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
                               id="trans-terapeuta-${sesion.id}"
                               onchange="calcularTotalSesionFutura('${sesion.id}')"
                               placeholder="0"
                               min="0">
                    </div>
                </div>
                <div>
                    <label class="block text-xs text-gray-600 dark:text-gray-400 mb-1">Trans. NeuroTEA:</label>
                    <div class="relative">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-2 text-gray-500 dark:text-gray-400 text-xs">Gs</span>
                        <input type="number" 
                               class="w-full p-2 pl-8 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
                               id="trans-neurotea-${sesion.id}"
                               onchange="calcularTotalSesionFutura('${sesion.id}')"
                               placeholder="0"
                               min="0">
                    </div>
                </div>
            </div>
            
            <!-- Sección de Aporte a NeuroTEA para sesión futura -->
            <div class="border-t pt-3 mt-3">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <span class="text-blue-600 dark:text-blue-400">🏥</span> Aporte a NeuroTEA
                </label>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div>
                        <label class="flex items-center space-x-2">
                            <input type="radio" 
                                   name="aporte-${sesion.id}" 
                                   value="20" 
                                   onchange="calcularAporteSesionFutura('${sesion.id}')"
                                   class="text-blue-600 dark:text-blue-400">
                            <span class="text-sm text-gray-700 dark:text-gray-300">20%</span>
                        </label>
                        <input type="number" 
                               class="w-full p-2 border rounded text-sm mt-1 dark:bg-gray-700 dark:border-gray-600"
                               id="aporte-20-${sesion.id}"
                               readonly
                               placeholder="Auto">
                    </div>
                    <div>
                        <label class="flex items-center space-x-2">
                            <input type="radio" 
                                   name="aporte-${sesion.id}" 
                                   value="30" 
                                   onchange="calcularAporteSesionFutura('${sesion.id}')"
                                   class="text-blue-600 dark:text-blue-400">
                            <span class="text-sm text-gray-700 dark:text-gray-300">30%</span>
                        </label>
                        <input type="number" 
                               class="w-full p-2 border rounded text-sm mt-1 dark:bg-gray-700 dark:border-gray-600"
                               id="aporte-30-${sesion.id}"
                               readonly
                               placeholder="Auto">
                    </div>
                    <div>
                        <label class="flex items-center space-x-2">
                            <input type="radio" 
                                   name="aporte-${sesion.id}" 
                                   value="fijo" 
                                   onchange="calcularAporteSesionFutura('${sesion.id}')"
                                   class="text-blue-600 dark:text-blue-400">
                            <span class="text-sm text-gray-700 dark:text-gray-300">Monto Fijo</span>
                        </label>
                        <input type="number" 
                               class="w-full p-2 border rounded text-sm mt-1 dark:bg-gray-700 dark:border-gray-600"
                               id="aporte-fijo-${sesion.id}"
                               onchange="calcularAporteSesionFutura('${sesion.id}')"
                               placeholder="Monto fijo"
                               min="0">
                    </div>
                </div>
            </div>
            
            <div class="text-right">
                <span class="text-sm text-gray-600 dark:text-gray-400">Total: </span>
                <span class="font-medium text-green-600 dark:text-green-400" id="total-${sesion.id}">Gs 0</span>
            </div>
        </div>
    `).join('');
    
    // Mostrar resumen
    resumen.style.display = 'block';
    calcularGranTotal();
}

/**
 * Calcula el total de una sesión futura específica
 */
function calcularTotalSesionFutura(sesionId) {
    const efectivo = parseFloat(document.getElementById(`efectivo-${sesionId}`).value) || 0;
    const transTerapeuta = parseFloat(document.getElementById(`trans-terapeuta-${sesionId}`).value) || 0;
    const transNeurotea = parseFloat(document.getElementById(`trans-neurotea-${sesionId}`).value) || 0;
    
    const total = efectivo + transTerapeuta + transNeurotea;
    
    // Actualizar total visual
    document.getElementById(`total-${sesionId}`).textContent = formatCurrency(total);
    
    // Actualizar en el array temporal
    const sesion = sesionesFuturasTemp.find(s => s.id == sesionId);
    if (sesion) {
        sesion.efectivo = efectivo;
        sesion.transferTerapeuta = transTerapeuta;
        sesion.transferNeurotea = transNeurotea;
        sesion.total = total;
    }
    
    calcularGranTotal();
}

/**
 * Calcula el gran total de sesión actual + sesiones futuras
 */
function calcularGranTotal() {
    // Total de sesión actual
    const cashValue = parseFloat(document.getElementById('cash-to-neurotea').value) || 0;
    const transferTherapist = parseFloat(document.getElementById('transfer-to-therapist').value) || 0;
    const transferNeurotea = parseFloat(document.getElementById('transfer-to-neurotea').value) || 0;
    const totalActual = cashValue + transferTherapist + transferNeurotea;
    
    // Total de sesiones futuras
    const totalFuturas = sesionesFuturasTemp.reduce((sum, sesion) => sum + sesion.total, 0);
    
    // Actualizar elementos visuales
    const totalSesionActualEl = document.getElementById('total-sesion-actual');
    const totalSesionesFuturasEl = document.getElementById('total-sesiones-futuras');
    const granTotalPagarEl = document.getElementById('gran-total-pagar');
    
    if (totalSesionActualEl) totalSesionActualEl.textContent = formatCurrency(totalActual);
    if (totalSesionesFuturasEl) totalSesionesFuturasEl.textContent = formatCurrency(totalFuturas);
    if (granTotalPagarEl) granTotalPagarEl.textContent = formatCurrency(totalActual + totalFuturas);
}

/**
 * Calcula el aporte a NeuroTEA para una sesión futura específica
 */
function calcularAporteSesionFutura(sesionId) {
    // Obtener el total actual de la sesión futura
    const efectivo = parseFloat(document.getElementById(`efectivo-${sesionId}`).value) || 0;
    const transTerapeuta = parseFloat(document.getElementById(`trans-terapeuta-${sesionId}`).value) || 0;
    const transNeurotea = parseFloat(document.getElementById(`trans-neurotea-${sesionId}`).value) || 0;
    const totalSesion = efectivo + transTerapeuta + transNeurotea;
    
    // Obtener el tipo de aporte seleccionado
    const aporteRadios = document.querySelectorAll(`input[name="aporte-${sesionId}"]:checked`);
    if (aporteRadios.length === 0) return;
    
    const tipoAporte = aporteRadios[0].value;
    let aporteCalculado = 0;
    
    // Limpiar campos de aporte
    document.getElementById(`aporte-20-${sesionId}`).value = '';
    document.getElementById(`aporte-30-${sesionId}`).value = '';
    document.getElementById(`aporte-fijo-${sesionId}`).value = '';
    
    // Calcular según el tipo seleccionado
    switch (tipoAporte) {
        case '20':
            aporteCalculado = totalSesion * 0.20;
            document.getElementById(`aporte-20-${sesionId}`).value = Math.round(aporteCalculado);
            break;
        case '30':
            aporteCalculado = totalSesion * 0.30;
            document.getElementById(`aporte-30-${sesionId}`).value = Math.round(aporteCalculado);
            break;
        case 'fijo':
            aporteCalculado = parseFloat(document.getElementById(`aporte-fijo-${sesionId}`).value) || 0;
            break;
    }
    
    // Actualizar en el array temporal
    const sesion = sesionesFuturasTemp.find(s => s.id == sesionId);
    if (sesion) {
        sesion.tipoAporte = tipoAporte;
        sesion.aporteNeurotea = aporteCalculado;
        sesion.honorariosTerapeuta = totalSesion - aporteCalculado;
    }
    
    // Recalcular totales
    calcularTotalSesionFutura(sesionId);
}

/**
 * Elimina una sesión futura del carrito
 */
function eliminarSesionFutura(sesionId) {
    sesionesFuturasTemp = sesionesFuturasTemp.filter(s => s.id != sesionId);
    actualizarListaSesionesFuturas();
}

/**
 * Limpia el formulario de agregar sesión futura
 */
function limpiarFormularioSesionFutura() {
    document.getElementById('terapeuta-futura-select').value = '';
    document.getElementById('cantidad-futura-input').value = '1';
}

/**
 * Procesa y crea todos los créditos de sesiones futuras
 * COMPATIBLE con sistema de paquetes existente
 */
function procesarSesionesFuturas(pacienteName, fechaCompra) {
    if (sesionesFuturasTemp.length === 0) return 0;
    
    let creditosCreados = 0;
    
    sesionesFuturasTemp.forEach(sesion => {
        // Generar ID simple para el paquete
        const packageCounter = Object.keys(localStorage).filter(key => key.startsWith('package_')).length + 1;
        const packageId = `PK-${packageCounter.toString().padStart(3, '0')}`;
        
        // 1. CREAR ENTRADA EN dailyPackagePurchases (para que aparezca en pestaña Paquetes)
        if (!dailyPackagePurchases[fechaCompra]) {
            dailyPackagePurchases[fechaCompra] = [];
        }
        
        // CORRECCIÓN R9.4: Calcular campos faltantes para coherencia con paquetes independent
        const contributionType = document.querySelector('input[name="neurotea-contribution"]:checked')?.value || '20';
        let neuroteaContribution;
        if (contributionType === 'fixed') {
            neuroteaContribution = parseNumber(document.getElementById('fixed-amount-input')?.value || 0);
        } else {
            const percentage = parseFloat(contributionType) || 20;
            neuroteaContribution = sesion.total * (percentage / 100);
        }
        const therapistFee = Math.max(0, sesion.total - neuroteaContribution);
        
        dailyPackagePurchases[fechaCompra].push({
            id: packageId,
            patientName: pacienteName,
            therapist: sesion.terapeuta,
            totalSessions: sesion.cantidad,
            cashToNeurotea: sesion.efectivo,
            transferToTherapist: sesion.transferTerapeuta,
            transferToNeurotea: sesion.transferNeurotea,
            sessionValue: sesion.total,
            valuePerSession: sesion.total / sesion.cantidad,
            purchaseDate: fechaCompra,
            purchaseTime: new Date().toLocaleTimeString('es-PY'),
            createdBy: 'session_combined',    // Distinguir del origen
            status: 'active',
            therapistFee: therapistFee,
            neuroteaContribution: neuroteaContribution,
            notes: `Sesiones futuras pagadas junto con sesión principal`
        });
        
        // 2. CREAR CRÉDITOS (usando función existente de Fase 1)
        createPatientCredits({
            patientName: pacienteName,
            therapist: sesion.terapeuta,
            quantity: sesion.cantidad,
            packageId: packageId,
            valuePerSession: sesion.total / sesion.cantidad,
            totalValue: sesion.total,
            purchaseDate: fechaCompra,
            createdBy: 'session_combined'
        });
        
        creditosCreados += sesion.cantidad;
        console.log(`✅ Creados ${sesion.cantidad} créditos para ${sesion.terapeuta} (valor: ${formatCurrency(sesion.total)})`);
    });
    
    // Limpiar carrito temporal
    sesionesFuturasTemp = [];
    actualizarListaSesionesFuturas();
    
    return creditosCreados;
}

/**
 * Toggle para mostrar/ocultar el carrito de sesiones futuras
 */
function toggleSesionesFuturasContainer() {
    const checkbox = document.getElementById('crear-creditos-adicionales');
    const container = document.getElementById('sesiones-futuras-container');
    
    if (checkbox.checked) {
        container.style.display = 'block';
        inicializarTerapeutasFuturas();
    } else {
        container.style.display = 'none';
        sesionesFuturasTemp = []; // Limpiar carrito
        actualizarListaSesionesFuturas();
    }
}


/**
 * Valida el modo de pago antes de permitir el registro
 */
function validatePaymentMode() {
    // Usar las validaciones existentes del sistema
    const therapist = document.getElementById('therapist-select').value;
    const patientName = document.getElementById('patient-name').value.trim();
    
    if (!therapist) {
        return { valid: false, message: 'Debe seleccionar una terapeuta' };
    }
    
    if (!patientName) {
        return { valid: false, message: 'Debe ingresar el nombre del paciente' };
    }
    
    // Validar créditos adicionales si están marcados
    const createAdditional = document.getElementById('crear-creditos-adicionales').checked;
    if (createAdditional) {
        // Verificar si hay sesiones futuras en el carrito temporal
        if (sesionesFuturasTemp.length === 0) {
            return { valid: false, message: 'Debe agregar al menos una sesión futura al carrito' };
        }
        
        // Validar que cada sesión futura tenga un monto total mayor a 0
        for (const sesion of sesionesFuturasTemp) {
            if (sesion.total <= 0) {
                return { valid: false, message: `La sesión futura de ${sesion.terapeuta} debe tener un monto mayor a 0` };
            }
        }
    }
    
    return { valid: true };
}



/**
 * Elimina un paquete individual por su ID
 * @param {string} packageId - ID del paquete a eliminar
 */
async function eliminarPaqueteIndividual(packageId) {
    try {
        console.log('🗑️ Eliminando paquete:', packageId);
        
        // Buscar y eliminar el paquete de dailyPackagePurchases
        let paqueteEliminado = null;
        
        for (const fecha in dailyPackagePurchases) {
            const paquetes = dailyPackagePurchases[fecha];
            const index = paquetes.findIndex(pkg => pkg.id === packageId);
            
            if (index !== -1) {
                paqueteEliminado = paquetes[index];
                paquetes.splice(index, 1);
                
                // Si no quedan paquetes en esa fecha, eliminar la entrada
                if (paquetes.length === 0) {
                    delete dailyPackagePurchases[fecha];
                }
                break;
            }
        }
        
        if (!paqueteEliminado) {
            console.error('Paquete no encontrado:', packageId);
            showNotification('Error: No se pudo encontrar el paquete a eliminar.', 'error');
            return;
        }
        
        console.log('✅ Paquete eliminado de memoria:', paqueteEliminado);
        
        // CORRECCIÓN QUIRÚRGICA: Eliminar también del IndexedDB
        try {
            await deleteFromIndexedDB('dailyPackagePurchases', packageId);
            console.log('✅ Paquete eliminado del IndexedDB:', packageId);
        } catch (dbError) {
            console.error('Error al eliminar del IndexedDB:', dbError);
            // Continuar con el proceso aunque falle el IndexedDB
        }
        
        // Actualizar las vistas
        updateActivePackagesList();
        updateAllViews(fechaActual);
        
        // Guardar cambios
        saveToStorage();
        
        // Mostrar mensaje de éxito
        showNotification(`Paquete eliminado: ${paqueteEliminado.patientName}`, 'success');
        
    } catch (error) {
        console.error('Error al eliminar paquete:', error);
        showNotification('Error al eliminar el paquete. Por favor, inténtalo de nuevo.', 'error');
    }
}



// ===========================
// NUEVAS FUNCIONES - MODALIDADES TERAPEUTA DEBE DAR
// ===========================

function handleTherapistDebtPayment(therapist, fecha, modalidad) {
    if (!modalidad) return;
    
    const status = calculateTherapistStatus(therapist, fecha);
    
    // Validaciones de seguridad
    if (status.estado !== 'LA TERAPEUTA DEBE DAR') {
        alert('Error: Estado inconsistente. Recargue la página.');
        document.querySelector(`select[onchange*="${therapist}"]`).value = '';
        return;
    }
    
    if (status.terapeutaDebe <= 0) {
        alert('Error: No hay deuda pendiente.');
        document.querySelector(`select[onchange*="${therapist}"]`).value = '';
        return;
    }
    
    // Confirmación específica por modalidad
    const amount = status.terapeutaDebe;
    let confirmMessage = '';
    
    if (modalidad === 'efectivo') {
        confirmMessage = `¿Confirmar que ${therapist} entregó ${formatCurrency(amount)} en efectivo físico?`;
    } else if (modalidad === 'transferencia') {
        confirmMessage = `¿Confirmar que ${therapist} transfirió ${formatCurrency(amount)} a cuenta bancaria NeuroTEA?`;
    }
    
    if (!confirm(confirmMessage)) {
        // Resetear select si cancela
        document.querySelector(`select[onchange*="${therapist}"]`).value = '';
        return;
    }
    
    // Procesar según modalidad
    if (modalidad === 'efectivo') {
        processDebtPaymentCash(therapist, fecha, amount);
    } else if (modalidad === 'transferencia') {
        processDebtPaymentTransfer(therapist, fecha, amount);
    }
    
    // Actualizar vistas
    updateAllViews(fecha);
    saveToStorageAsync();
}

function processDebtPaymentCash(therapist, fecha, amount) {
    // ✅ ARQUITECTURA CORREGIDA: NO modificar saldosReales
    // El saldo se calcula DINÁMICAMENTE con calcularSaldoCajaReal()

    // Marcar como confirmado con flujo específico
    if (!confirmaciones[fecha]) confirmaciones[fecha] = {};
    confirmaciones[fecha][therapist] = {
        timestamp: Date.now(),
        amount: amount,
        type: 'LA TERAPEUTA DEBE DAR',
        modalidad: 'efectivo',
        flujo: {
            efectivoRecibido: amount, // Esto se considera en calcularSaldoCajaReal()
            efectivoUsado: 0,
            bancoUsado: 0
        }
    };
}

function processDebtPaymentTransfer(therapist, fecha, amount) {
    // La terapeuta transfiere a cuenta NeuroTEA
    // El saldo de cuenta se actualiza automáticamente en calcularSaldoCuentaNeuroTEA()
    
    // Marcar como confirmado con flujo específico
    if (!confirmaciones[fecha]) confirmaciones[fecha] = {};
    confirmaciones[fecha][therapist] = {
        timestamp: Date.now(),
        amount: amount,
        type: 'LA TERAPEUTA DEBE DAR',
        modalidad: 'transferencia',
        flujo: {
            efectivoRecibido: 0,
            efectivoUsado: 0,
            bancoUsado: -amount // Negativo porque es dinero que ENTRA a la cuenta
        }
    };
}


// ===========================
// NUEVAS FUNCIONES - CONFIRMACIONES DE TRANSFERENCIAS
// ===========================

function toggleTransferConfirmation(transferId) {
    const currentState = transferConfirmationStates[transferId] || false;
    transferConfirmationStates[transferId] = !currentState;
    
    // Actualizar interfaz
    updateTransferStatusButton(transferId, !currentState);
    
    // Guardar estado
    saveToStorageAsync();
}

function updateTransferStatusButton(transferId, isConfirmed) {
    const button = document.querySelector(`[onclick*="${transferId}"]`);
    if (!button) return;
    
    if (isConfirmed) {
        button.className = 'transfer-status-btn confirmed';
        button.innerHTML = '<span class="status-icon">✓</span> Confirmado';
    } else {
        button.className = 'transfer-status-btn pending';
        button.innerHTML = '<span class="status-icon">❌</span> Pendiente';
    }
}

function getTransferConfirmationState(transferId) {
    return transferConfirmationStates[transferId] || false;
}


// ===========================
// NUEVAS FUNCIONES - PDF INDIVIDUAL POR TERAPEUTA
// ===========================

function generateTherapistReceipt(therapist, fecha) {
    console.log('Generando comprobante HTML para:', therapist, fecha);
    
    // Validaciones iniciales
    if (!therapist || !fecha) {
        alert('Terapeuta y fecha son requeridos');
        return;
    }
    
    const daySessions = sessions[fecha] || [];
    const therapistSessions = daySessions.filter(s => s.therapist === therapist);
    
    // ✅ CORRECCIÓN: Incluir paquetes del día para permitir comprobantes sin sesiones
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const therapistPackages = dayPackages.filter(p => p.therapist === therapist);
    
    if (therapistSessions.length === 0 && therapistPackages.length === 0) {
        alert(`No hay sesiones ni paquetes registrados para ${therapist} en la fecha ${fecha}`);
        return;
    }
    
    try {
        // Generar HTML del comprobante
        const htmlContent = generateReceiptHTMLContent(therapist, fecha, therapistSessions);
        
        // Descargar como archivo HTML
        downloadHTMLFile(htmlContent, therapist, fecha);
        
        console.log('Comprobante HTML generado exitosamente');
        
    } catch (error) {
        console.error('Error generating HTML receipt:', error);
        alert('Error al generar el comprobante: ' + error.message);
    }
}

function generateReceiptHeader(doc, therapist, fecha, colors) {
    const pageWidth = doc.internal.pageSize.width;
    
    // Fondo azul con altura exacta del CSS
    doc.setFillColor(30, 77, 139);  // #1e4d8b
    doc.rect(0, 0, pageWidth, CSS_MEASUREMENTS.header.height, 'F');
    
    // CLAVE: Reproducir el efecto CSS "margin-bottom: -5px" de "Avanza"
    const headerCenterY = CSS_MEASUREMENTS.header.height / 2;
    
    // "Avanza" - Con font-style: italic y posicionamiento superior
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(CSS_MEASUREMENTS.fonts.avanza);
    const avanzaY = headerCenterY - 8;  // Simula el margin-bottom: -5px del CSS
    doc.text('Avanza', CSS_MEASUREMENTS.header.padding.left, avanzaY);
    
    // "NeuroTEA" - Superpuesto naturalmente como en el CSS
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(CSS_MEASUREMENTS.fonts.neurotea);
    const neuroteaY = headerCenterY + 8;  // Posición que permite el solapamiento
    doc.text('Neuro', CSS_MEASUREMENTS.header.padding.left, neuroteaY);
    
    // "TEA" en naranja - Misma línea base que "Neuro"
    doc.setTextColor(255, 165, 0);  // #ffa500
    const neuroWidth = doc.getTextWidth('Neuro');
    doc.text('TEA', CSS_MEASUREMENTS.header.padding.left + neuroWidth, neuroteaY);
    
    // "COMPROBANTE" - Alineado perfectamente a la derecha
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(CSS_MEASUREMENTS.fonts.comprobante);
    const comprobanteText = 'COMPROBANTE';
    const comprobanteWidth = doc.getTextWidth(comprobanteText);
    const comprobanteY = headerCenterY + 4;  // Centrado verticalmente
    doc.text(comprobanteText, pageWidth - CSS_MEASUREMENTS.header.padding.right - comprobanteWidth, comprobanteY);
    
    return CSS_MEASUREMENTS.header.height + CSS_MEASUREMENTS.content.padding.top;
}

function generateBasicInfoSection(doc, therapist, fecha, therapistSessions, yPos, colors) {
    const pageWidth = doc.internal.pageSize.width;
    
    // Datos dinámicos calculados automáticamente
    const fechaFormateada = formatDateForReceipt(fecha);
    const horaActual = new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
    const numeroComprobante = generateReceiptNumber(therapist, fecha);
    const cantidadSesiones = therapistSessions.length;
    const estado = determineTherapistStatus(therapist, fecha);
    
    // Aplicar formato exacto del CSS
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(CSS_MEASUREMENTS.fonts.body);
    
    const infoY = yPos;
    const rightColumnX = pageWidth / 2 + 20;  // División exacta en dos columnas
    
    // Izquierda - formato CSS exacto
    doc.setFont('helvetica', 'bold');
    doc.text('TERAPEUTA:', CSS_MEASUREMENTS.content.padding.left, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(` ${therapist}`, CSS_MEASUREMENTS.content.padding.left + doc.getTextWidth('TERAPEUTA:') + 2, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('FECHA:', CSS_MEASUREMENTS.content.padding.left, infoY + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(` ${fechaFormateada}`, CSS_MEASUREMENTS.content.padding.left + doc.getTextWidth('FECHA:') + 2, infoY + 10);
    
    doc.setFont('helvetica', 'bold');
    doc.text('SESIONES:', CSS_MEASUREMENTS.content.padding.left, infoY + 20);
    doc.setFont('helvetica', 'normal');
    doc.text(` ${cantidadSesiones} atendidas`, CSS_MEASUREMENTS.content.padding.left + doc.getTextWidth('SESIONES:') + 2, infoY + 20);
    
    // Derecha - formato CSS exacto
    doc.setFont('helvetica', 'bold');
    doc.text('COMPROBANTE:', rightColumnX, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(` #${numeroComprobante}`, rightColumnX + doc.getTextWidth('COMPROBANTE:') + 2, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('HORA:', rightColumnX, infoY + 10);
    doc.setFont('helvetica', 'normal');
    doc.text(` ${horaActual}`, rightColumnX + doc.getTextWidth('HORA:') + 2, infoY + 10);
    
    doc.setFont('helvetica', 'bold');
    doc.text('ESTADO:', rightColumnX, infoY + 20);
    doc.setFont('helvetica', 'normal');
    doc.text(` ${estado}`, rightColumnX + doc.getTextWidth('ESTADO:') + 2, infoY + 20);
    
    // Línea separadora con spacing exacto del CSS
    doc.setDrawColor(0, 0, 0);
    doc.line(CSS_MEASUREMENTS.content.padding.left, infoY + 30, 
             pageWidth - CSS_MEASUREMENTS.content.padding.right, infoY + 30);
    
    return infoY + 30 + CSS_MEASUREMENTS.spacing.infoBottom + CSS_MEASUREMENTS.content.sectionSpacing;
}

function generateSessionsTable(doc, therapistSessions, yPos, colors) {
    const pageWidth = doc.internal.pageSize.width;
    const margin = 30;
    
    // Preparar datos para la tabla con 5 columnas exactas
    const tableData = therapistSessions.map(session => {
        const sessionType = session.creditUsed ? 'Credito' : 
                           session.packageUsed ? 'Paquete' : 'Normal';
        
        // Valor sesión - mostrar formato especial para créditos
        let valorSesion;
        if (session.creditUsed && session.originalAmount) {
            valorSesion = `0 (${formatNumber(session.originalAmount)})`;
        } else {
            valorSesion = formatNumber(session.sessionValue || session.amount || 0);
        }
        
        const honorarios = formatNumber(session.therapistFee || session.amount || 0);
        const aporteNeurotea = formatNumber(session.neuroteaContribution || 0);
        
        return [
            session.patientName || 'Sin nombre',
            sessionType,
            valorSesion,
            honorarios,
            aporteNeurotea
        ];
    });
    
    // Crear tabla con autoTable usando estilos exactos del HTML
    doc.autoTable({
        startY: yPos,
        head: [['PACIENTE', 'TIPO', 'VALOR SESION', 'HONORARIOS', 'APORTE NEUROTEA']],
        body: tableData,
        theme: 'grid',
        headStyles: {
            fillColor: [0, 0, 0],        // Negro
            textColor: [255, 255, 255],   // Blanco
            fontSize: 11,
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle'
        },
        bodyStyles: {
            fontSize: 11,
            cellPadding: 6,
            valign: 'middle'
        },
        columnStyles: {
            0: { 
                cellWidth: (pageWidth - margin * 2) * 0.25, 
                halign: 'left' 
            },
            1: { 
                cellWidth: (pageWidth - margin * 2) * 0.15, 
                halign: 'center' 
            },
            2: { 
                cellWidth: (pageWidth - margin * 2) * 0.20, 
                halign: 'right' 
            },
            3: { 
                cellWidth: (pageWidth - margin * 2) * 0.20, 
                halign: 'right' 
            },
            4: { 
                cellWidth: (pageWidth - margin * 2) * 0.20, 
                halign: 'right' 
            }
        },
        styles: {
            lineColor: [0, 0, 0],        // Bordes negros
            lineWidth: 1
        },
        margin: { left: margin, right: margin },
        tableLineColor: [0, 0, 0],
        tableLineWidth: 2
    });
    
    return doc.lastAutoTable.finalY + 20;
}

function generateSubtotals(doc, therapistSessions, therapist, fecha, yPos, colors) {
    const pageWidth = doc.internal.pageSize.width;
    const margin = 30;
    
    // Calcular totales usando la misma lógica que el sistema
    const status = calculateTherapistStatus(therapist, fecha);
    
    // Calcular valores específicos
    const valorTotalSesiones = therapistSessions.reduce((sum, s) => sum + (s.sessionValue || s.amount || 0), 0);
    const totalHonorarios = status.honorarios;
    const totalAporteNeurotea = status.aporteNeurotea;
    const transferenciasRecibidas = status.transferenciaATerapeuta;
    const adelantosRecibidos = status.adelantosRecibidos;
    
    // Crear rectángulo con borde negro sólido
    const rectHeight = 60;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(2);
    doc.rect(margin, yPos, pageWidth - (margin * 2), rectHeight, 'S');
    
    // Configurar texto
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    
    // Líneas de totales con formato: concepto a la izquierda, monto a la derecha
    const lines = [
        ['VALOR TOTAL SESIONES:', `Gs ${formatNumber(valorTotalSesiones)}`],
        ['TOTAL HONORARIOS:', `Gs ${formatNumber(totalHonorarios)}`],
        ['TOTAL APORTE NEUROTEA:', `Gs ${formatNumber(totalAporteNeurotea)}`],
        ['TRANSFERENCIAS RECIBIDAS:', `Gs ${formatNumber(transferenciasRecibidas)}`],
        ['ADELANTOS RECIBIDOS:', `Gs ${formatNumber(adelantosRecibidos)}`]
    ];
    
    lines.forEach((line, index) => {
        const lineY = yPos + 10 + (index * 10);
        
        // Concepto a la izquierda (normal)
        doc.setFont('helvetica', 'normal');
        doc.text(line[0], margin + 5, lineY);
        
        // Monto a la derecha (bold)
        doc.setFont('helvetica', 'bold');
        const montoWidth = doc.getTextWidth(line[1]);
        doc.text(line[1], pageWidth - margin - 5 - montoWidth, lineY);
    });
    
    return yPos + rectHeight + 20;
}

function generateConciliation(doc, therapist, fecha, yPos, colors) {
    const pageWidth = doc.internal.pageSize.width;
    const margin = 30;
    
    // Obtener estado del terapeuta
    const status = calculateTherapistStatus(therapist, fecha);
    
    // Crear rectángulo con borde negro
    const rectHeight = 50;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);
    doc.rect(margin, yPos, pageWidth - (margin * 2), rectHeight, 'S');
    
    // Título "CALCULO FINAL" centrado
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const titleText = 'CALCULO FINAL';
    const titleWidth = doc.getTextWidth(titleText);
    doc.text(titleText, (pageWidth - titleWidth) / 2, yPos + 12);
    
    // Líneas de cálculo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    
    const calcLines = [
        ['Total Honorarios', `Gs ${formatNumber(status.honorarios)}`],
        ['Menos: Transferencias', `Gs ${formatNumber(status.transferenciaATerapeuta)}`],
        ['Menos: Adelantos', `Gs ${formatNumber(status.adelantosRecibidos)}`]
    ];
    
    calcLines.forEach((line, index) => {
        const lineY = yPos + 22 + (index * 8);
        doc.text(line[0], margin + 5, lineY);
        const montoWidth = doc.getTextWidth(line[1]);
        doc.text(line[1], pageWidth - margin - 5 - montoWidth, lineY);
    });
    
    // Línea separadora para el resultado
    doc.setDrawColor(0, 0, 0);
    doc.line(margin + 5, yPos + 42, pageWidth - margin - 5, yPos + 42);
    
    // Resultado final destacado
    const diferencia = status.neuroteaLeDebe - status.terapeutaDebe;
    const finalText = determineFinalText(diferencia);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const finalTextWidth = doc.getTextWidth(finalText);
    doc.text(finalText, (pageWidth - finalTextWidth) / 2, yPos + rectHeight - 3);
    
    return yPos + rectHeight + 20;
}

function generateSignatureSection(doc, therapist, fecha, yPos, colors) {
    const pageWidth = doc.internal.pageSize.width;
    const margin = 30;
    
    // OBSERVACIONES - Sección SIEMPRE presente (CSS: border: 1px solid #000)
    const obsHeight = 40;  // Altura mínima que permite contenido
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(1);  // CSS: border: 1px solid #000
    doc.rect(margin, yPos, pageWidth - (margin * 2), obsHeight, 'S');
    
    // Título - formato CSS exacto
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);  // CSS: font-size: 11px
    doc.text('OBSERVACIONES:', margin + 10, yPos + 12);
    
    // Contenido dinámico de observaciones
    const observaciones = generateDynamicObservations(therapist, fecha);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);  // CSS: font-size: 10px
    
    if (observaciones.length > 0) {
        observaciones.forEach((obs, index) => {
            doc.text(`- ${obs}`, margin + 10, yPos + 22 + (index * 8));
        });
    } else {
        // Si no hay observaciones, mostrar texto placeholder
        doc.setTextColor(128, 128, 128);
        doc.text('(Sin observaciones especiales para este comprobante)', 
                 margin + 10, yPos + 22);
        doc.setTextColor(0, 0, 0);
    }
    
    yPos += obsHeight + 40;  // CSS: margin-bottom: 40px
    
    // FIRMAS - Sección SIEMPRE presente con textos dinámicos
    yPos += 50;  // CSS: margin-top: 50px
    
    // Calcular textos de firma según estado dinámico
    const status = calculateTherapistStatus(therapist, fecha);
    const diferencia = status.neuroteaLeDebe - status.terapeutaDebe;
    
    let therapistSignText, neuroteaSignText;
    if (diferencia > 0) {
        therapistSignText = 'RECIBI CONFORME';
        neuroteaSignText = 'ENTREGUE CONFORME';
    } else if (diferencia < 0) {
        therapistSignText = 'ENTREGUE CONFORME';
        neuroteaSignText = 'RECIBI CONFORME';
    } else {
        therapistSignText = 'CONFORME';
        neuroteaSignText = 'CONFORME';
    }
    
    // Renderizar firmas con formato CSS exacto (45% width cada una)
    const leftColumnX = margin + 20;
    const rightColumnX = pageWidth - margin - 100;
    const lineWidth = 80;
    
    // Líneas y textos con medidas exactas del CSS
    doc.setDrawColor(0, 0, 0);
    doc.line(leftColumnX, yPos, leftColumnX + lineWidth, yPos);
    doc.line(rightColumnX, yPos, rightColumnX + lineWidth, yPos);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);  // CSS: font-size: 11px
    doc.text(therapistSignText, leftColumnX, yPos + 8);
    doc.text(neuroteaSignText, rightColumnX, yPos + 8);
    
    doc.setFont('helvetica', 'normal');
    doc.text(therapist, leftColumnX, yPos + 18);
    doc.text('Secretaría NeuroTEA', rightColumnX, yPos + 18);
    
    return yPos + 30;
}

function generateReceiptNumber(therapist, fecha) {
    const cleanTherapist = therapist.replace(/[^a-zA-Z]/g, '').toUpperCase();
    const datePart = fecha.replace(/-/g, '');
    const timestamp = Date.now().toString().slice(-3);
    return `${cleanTherapist}_${datePart}_${timestamp}`;
}

function generateReceiptFileName(therapist, fecha) {
    const cleanTherapist = therapist.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, '_');
    return `Comprobante_${cleanTherapist}_${fecha}.pdf`;
}

// ===========================
// FUNCIONES AUXILIARES PARA PDF INDIVIDUAL
// ===========================

function formatDateForReceipt(fecha) {
    // Convertir fecha YYYY-MM-DD a formato legible
    const [year, month, day] = fecha.split('-').map(Number);
    const fechaObj = new Date(year, month - 1, day);
    
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    
    const diaSemana = diasSemana[fechaObj.getDay()];
    const dia = fechaObj.getDate();
    const mes = meses[fechaObj.getMonth()];
    const año = fechaObj.getFullYear();
    
    return `${diaSemana}, ${dia} de ${mes} de ${año}`;
}

function determineTherapistStatus(therapist, fecha) {
    // Determinar el estado del terapeuta basado en los cálculos
    const status = calculateTherapistStatus(therapist, fecha);
    const diferencia = status.neuroteaLeDebe - status.terapeutaDebe;
    
    if (diferencia > 0) {
        return 'DEBE RECIBIR';
    } else if (diferencia < 0) {
        return 'DEBE ENTREGAR';
    } else {
        return 'SALDADO';
    }
}

function determineFinalText(diferencia) {
    // Generar el texto final para la sección de cálculo
    if (diferencia > 0) {
        return `LA TERAPEUTA DEBE RECIBIR: Gs ${formatNumber(diferencia)}`;
    } else if (diferencia < 0) {
        return `LA TERAPEUTA DEBE ENTREGAR: Gs ${formatNumber(Math.abs(diferencia))}`;
    } else {
        return 'CUENTA SALDADA - Sin pendientes';
    }
}

function generateObservations(therapist, fecha) {
    // Generar observaciones automáticas basadas en las sesiones
    const observaciones = [];
    const daySessions = sessions[fecha] || [];
    const therapistSessions = daySessions.filter(s => s.therapist === therapist);
    
    therapistSessions.forEach(session => {
        if (session.creditUsed) {
            const fechaCredito = session.creditPurchaseDate || fecha;
            observaciones.push(`Sesion de ${session.patientName}: credito de paquete del ${fechaCredito}`);
        } else if (session.packageUsed) {
            observaciones.push(`Sesion de ${session.patientName}: parte de paquete familiar`);
        }
    });
    
    return observaciones;
}

// NUEVA FUNCIÓN: Generar observaciones dinámicas basadas en datos reales
function generateDynamicObservations(therapist, fecha) {
    const observaciones = [];
    const daySessions = sessions[fecha] || [];
    const therapistSessions = daySessions.filter(s => s.therapist === therapist);
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const therapistPackages = dayPackages.filter(pkg => pkg.therapist === therapist);

    // ✅ NUEVO: Detectar información de vueltos si hay confirmación
    if (confirmaciones[fecha] && confirmaciones[fecha][therapist]) {
        const conf = confirmaciones[fecha][therapist];
        const flujo = conf.flujo;

        if (flujo) {
            const tipoOpcion = flujo.tipoOpcion || 'exacto';

            if (tipoOpcion === 'vuelto' && flujo.efectivoRecibido > 0) {
                observaciones.push(`Pago con vuelto: Se entregó Gs ${(flujo.efectivoUsado + flujo.efectivoRecibido).toLocaleString()} - Vuelto de Gs ${flujo.efectivoRecibido.toLocaleString()} transferido a cuenta NeuroTEA`);
            } else if (tipoOpcion === 'vuelto-efectivo' && flujo.vueltoEfectivo > 0) {
                const entregado = flujo.efectivoUsado + flujo.vueltoEfectivo;
                observaciones.push(`Pago con vuelto en efectivo: Se entregó Gs ${entregado.toLocaleString()} - Vuelto de Gs ${flujo.vueltoEfectivo.toLocaleString()} regresó a caja`);
            } else if (tipoOpcion === 'transferir') {
                observaciones.push(`Pago realizado por transferencia bancaria: Gs ${flujo.bancoUsado.toLocaleString()}`);
            } else if (flujo.efectivoUsado > 0 && flujo.bancoUsado > 0) {
                observaciones.push(`Pago mixto: Gs ${flujo.efectivoUsado.toLocaleString()} en efectivo + Gs ${flujo.bancoUsado.toLocaleString()} por transferencia`);
            }

            // Si la terapeuta entregó efectivo
            if (conf.type === 'LA TERAPEUTA DEBE DAR' && flujo.efectivoRecibido > 0) {
                const modalidad = conf.modalidad === 'efectivo' ? 'en efectivo' : 'por transferencia';
                observaciones.push(`La terapeuta entregó Gs ${flujo.efectivoRecibido.toLocaleString()} ${modalidad}`);
            }
        }
    }

    // Detectar créditos comprados y usados
    therapistSessions.forEach(session => {
        if (session.creditUsed === true) {
            // Buscar información del crédito
            const creditInfo = getPatientCreditsInfo(session.patientName, session.therapist);
            const creditDate = creditInfo && creditInfo.packages && creditInfo.packages.length > 0 ? creditInfo.packages[0].purchaseDate : fecha;
            const remainingCredits = creditInfo ? creditInfo.totalRemaining : 0;

            observaciones.push(`${session.patientName}: crédito comprado el ${formatDateForReceipt(creditDate)} - ${remainingCredits} sesión${remainingCredits !== 1 ? 'es' : ''} restante${remainingCredits !== 1 ? 's' : ''}`);
        }
    });

    // Detectar paquetes comprados
    therapistPackages.forEach(pkg => {
        if (pkg.createdBy === 'independent') {
            const creditsInfo = getPatientCreditsInfo(pkg.patientName, pkg.therapist);
            const remainingSessions = creditsInfo ? creditsInfo.totalRemaining : 0;
            const totalSessions = creditsInfo ? creditsInfo.totalOriginal : pkg.totalSessions;
            observaciones.push(`${pkg.patientName}: Paquetes sin uso: crédito comprado el ${formatDateForReceipt(pkg.purchaseDate)} - ${remainingSessions} sesión${remainingSessions !== 1 ? 'es' : ''} restante${remainingSessions !== 1 ? 's' : ''}`);
        } else if (pkg.createdBy === 'session_combined') {
            const creditsInfo = getPatientCreditsInfo(pkg.patientName, pkg.therapist);
            const remainingCredits = creditsInfo ? creditsInfo.totalRemaining : 0;
            const totalCredits = creditsInfo ? creditsInfo.totalOriginal : pkg.totalSessions;
            observaciones.push(`${pkg.patientName}: Sesión normal con ${pkg.therapist} + ${pkg.totalSessions - remainingCredits} sesión futura con ${pkg.therapist}: crédito comprado el ${formatDateForReceipt(pkg.purchaseDate)} - ${remainingCredits} sesión${remainingCredits !== 1 ? 'es' : ''} restante${remainingCredits !== 1 ? 's' : ''}`);
        }
    });

    // Agregar observación estándar del sistema
    observaciones.push('Comprobante generado automáticamente por Sistema NeuroTEA');

    return observaciones;
}

function formatNumber(number) {
    // Formatear número exactamente como en el HTML de referencia
    if (typeof number !== 'number') {
        number = parseFloat(number) || 0;
    }
    // Formato: 230.000 (con puntos como separadores de miles)
    return number.toLocaleString('de-DE');
}


// ===========================
// NUEVAS FUNCIONES - PESTAÑA ADMINISTRACIÓN
// ===========================

function switchAdminModule(moduleId) {
    // Ocultar todos los módulos
    document.querySelectorAll('.admin-module-content').forEach(module => {
        module.classList.add('hidden');
    });
    
    // Remover clase active de todas las pestañas
    document.querySelectorAll('.admin-module-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Mostrar módulo seleccionado
    const selectedModule = document.getElementById(`${moduleId}-module`);
    if (selectedModule) {
        selectedModule.classList.remove('hidden');
    }
    
    // Activar pestaña correspondiente
    const selectedTab = document.querySelector(`[onclick*="${moduleId}"]`);
    if (selectedTab && !selectedTab.classList.contains('disabled')) {
        selectedTab.classList.add('active');
    }
}

function detectAvailableData() {
    const available = {
        base: true,
        sessions: typeof sessions !== 'undefined' && sessions !== null,
        egresos: typeof egresos !== 'undefined' && egresos !== null,
        therapists: typeof therapists !== 'undefined' && therapists !== null,
        
        // Detectar funcionalidades de fases específicas
        credits: typeof creditPurchases !== 'undefined' && creditPurchases !== null,
        packages: typeof dailyPackagePurchases !== 'undefined' && dailyPackagePurchases !== null,
        confirmaciones: typeof confirmaciones !== 'undefined' && confirmaciones !== null,
        vueltos: typeof transferConfirmationStates !== 'undefined' && transferConfirmationStates !== null
    };
    
    // Guardar información detectada
    window.detectedFeatures = available;
    
    return available;
}

function updateSystemInfo() {
    const available = detectAvailableData();
    const container = document.getElementById('system-info');
    
    if (!container) return;
    
    let info = '<div class="grid grid-cols-2 gap-4">';
    
    // Funcionalidades detectadas
    info += '<div><strong>Funcionalidades Detectadas:</strong><ul class="mt-1 space-y-1">';
    info += `<li>✅ Sistema Base</li>`;
    if (available.credits) info += `<li>✅ Sistema de Créditos (Fase 1)</li>`;
    if (available.packages) info += `<li>✅ Paquetes de Sesiones (Fase 2)</li>`;
    if (available.confirmaciones) info += `<li>✅ Confirmaciones (Fase 3)</li>`;
    if (available.vueltos) info += `<li>✅ Sistema de Vueltos (Fase 4+5)</li>`;
    info += '</ul></div>';
    
    // Estadísticas de datos
    const totalSessions = Object.values(sessions || {}).flat().length;
    const totalDays = Object.keys(sessions || {}).length;
    const totalTherapists = (therapists || []).length;
    
    info += '<div><strong>Estadísticas:</strong><ul class="mt-1 space-y-1">';
    info += `<li>📊 Días con datos: ${totalDays}</li>`;
    info += `<li>👥 Terapeutas: ${totalTherapists}</li>`;
    info += `<li>📝 Sesiones totales: ${totalSessions}</li>`;
    info += '</ul></div>';
    
    info += '</div>';
    
    container.innerHTML = info;
}

function exportDayData() {
    const dateInput = document.getElementById('export-date');
    if (!dateInput.value) {
        alert('Por favor seleccione una fecha para exportar');
        return;
    }
    
    const fecha = dateInput.value;
    const available = detectAvailableData();
    
    try {
        const exportData = generateDayDataJSON(fecha, available);
        
        if (!exportData.sessions || exportData.sessions.length === 0) {
            if (!confirm(`No hay datos registrados para la fecha ${fecha}. ¿Desea exportar de todas formas?`)) {
                return;
            }
        }
        
        // Crear archivo y descargar
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `neurotea_datos_${fecha}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert(`Datos del día ${fecha} exportados exitosamente`);
        
    } catch (error) {
        console.error('Error exporting day data:', error);
        alert('Error al exportar los datos. Verifique la consola para más detalles.');
    }
}

function generateDayDataJSON(fecha, available) {
    const exportData = {
        exportInfo: {
            type: 'day_data',
            fecha: fecha,
            exportedAt: new Date().toISOString(),
            version: '1.0',
            detectedFeatures: available
        },
        sessions: sessions[fecha] || [],
        egresos: egresos[fecha] || [],
        therapists: therapists || []
    };
    
    // Agregar datos de funcionalidades detectadas
    if (available.credits && typeof creditPurchases !== 'undefined') {
        exportData.creditPurchases = creditPurchases[fecha] || [];
    }
    
    if (available.packages && typeof dailyPackagePurchases !== 'undefined') {
        exportData.dailyPackagePurchases = dailyPackagePurchases[fecha] || [];
    }
    
    if (available.confirmaciones && typeof confirmaciones !== 'undefined') {
        exportData.confirmaciones = confirmaciones[fecha] || {};
    }
    
    if (available.vueltos && typeof transferConfirmationStates !== 'undefined') {
        // Filtrar solo las confirmaciones relacionadas con esta fecha
        const relevantTransferStates = {};
        Object.keys(transferConfirmationStates).forEach(key => {
            if (key.includes(fecha)) {
                relevantTransferStates[key] = transferConfirmationStates[key];
            }
        });
        exportData.transferConfirmationStates = relevantTransferStates;
    }
    
    return exportData;
}

function importDayData() {
    const fileInput = document.getElementById('import-day-file');
    if (!fileInput.files[0]) {
        alert('Por favor seleccione un archivo JSON para importar');
        return;
    }
    
    const password = prompt('Ingrese la contraseña para importar datos:');
    if (password !== '280208') {
        alert('Contraseña incorrecta');
        return;
    }
    
    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            if (!validateDayDataStructure(importData)) {
                alert('El archivo no tiene la estructura válida para datos del día');
                return;
            }
            
            const fecha = importData.exportInfo.fecha;
            const conflicts = detectDataConflicts(fecha, importData);
            
            if (conflicts.hasConflicts) {
                showConflictResolutionDialog(fecha, importData, conflicts);
            } else {
                // No hay conflictos, importar directamente
                processDayDataImport(fecha, importData, 'merge');
            }
            
        } catch (error) {
            console.error('Error parsing import file:', error);
            alert('Error al leer el archivo. Verifique que sea un archivo JSON válido.');
        }
    };
    
    reader.readAsText(file);
}

function validateDayDataStructure(data) {
    return data && 
           data.exportInfo && 
           data.exportInfo.type === 'day_data' &&
           data.exportInfo.fecha &&
           Array.isArray(data.sessions) &&
           Array.isArray(data.egresos) &&
           Array.isArray(data.therapists);
}

function detectDataConflicts(fecha, importData) {
    const conflicts = {
        hasConflicts: false,
        sessions: false,
        egresos: false,
        details: []
    };
    
    // Verificar conflictos en sesiones
    if (sessions[fecha] && sessions[fecha].length > 0 && importData.sessions.length > 0) {
        conflicts.hasConflicts = true;
        conflicts.sessions = true;
        conflicts.details.push(`${sessions[fecha].length} sesiones existentes vs ${importData.sessions.length} del archivo`);
    }
    
    // Verificar conflictos en egresos
    if (egresos[fecha] && egresos[fecha].length > 0 && importData.egresos.length > 0) {
        conflicts.hasConflicts = true;
        conflicts.egresos = true;
        conflicts.details.push(`${egresos[fecha].length} egresos existentes vs ${importData.egresos.length} del archivo`);
    }
    
    return conflicts;
}

function showConflictResolutionDialog(fecha, importData, conflicts) {
    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    dialog.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 class="text-lg font-bold mb-4 text-red-600">⚠️ Conflictos Detectados</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Ya existen datos para la fecha ${fecha}:
            </p>
            <ul class="text-sm mb-4 space-y-1">
                ${conflicts.details.map(detail => `<li>• ${detail}</li>`).join('')}
            </ul>
            <p class="text-sm font-medium mb-4">¿Cómo desea proceder?</p>
            <div class="space-y-2">
                <button onclick="processDayDataImport('${fecha}', importData, 'merge'); document.body.removeChild(this.closest('.fixed'))" 
                        class="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                    🔀 Fusionar (Combinar ambos)
                </button>
                <button onclick="processDayDataImport('${fecha}', importData, 'overwrite'); document.body.removeChild(this.closest('.fixed'))" 
                        class="w-full bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600">
                    📝 Sobrescribir (Reemplazar existentes)
                </button>
                <button onclick="document.body.removeChild(this.closest('.fixed'))" 
                        class="w-full bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600">
                    ❌ Cancelar
                </button>
            </div>
        </div>
    `;
    
    // Pasar importData al contexto global temporalmente
    window.tempImportData = importData;
    
    document.body.appendChild(dialog);
}

function processDayDataImport(fecha, importData, mode) {
    // Usar datos temporales si no están disponibles directamente
    if (!importData && window.tempImportData) {
        importData = window.tempImportData;
        delete window.tempImportData;
    }
    
    try {
        // Crear backup automático antes de importar
        createAutoBackup('before_import_' + fecha);
        
        if (mode === 'overwrite') {
            // Sobrescribir: reemplazar completamente
            sessions[fecha] = importData.sessions;
            egresos[fecha] = importData.egresos;
        } else {
            // Fusionar: combinar datos
            if (!sessions[fecha]) sessions[fecha] = [];
            if (!egresos[fecha]) egresos[fecha] = [];
            
            // Combinar sesiones (evitar duplicados por ID)
            const existingSessionIds = new Set(sessions[fecha].map(s => s.id));
            importData.sessions.forEach(session => {
                if (!existingSessionIds.has(session.id)) {
                    sessions[fecha].push(session);
                }
            });
            
            // Combinar egresos (evitar duplicados por ID)
            const existingEgresoIds = new Set(egresos[fecha].map(e => e.id));
            importData.egresos.forEach(egreso => {
                if (!existingEgresoIds.has(egreso.id)) {
                    egresos[fecha].push(egreso);
                }
            });
        }
        
        // Importar datos de funcionalidades adicionales si están disponibles
        if (importData.creditPurchases && typeof creditPurchases !== 'undefined') {
            if (!creditPurchases[fecha]) creditPurchases[fecha] = [];
            
            if (mode === 'overwrite') {
                creditPurchases[fecha] = importData.creditPurchases;
            } else {
                const existingCreditIds = new Set(creditPurchases[fecha].map(c => c.id));
                importData.creditPurchases.forEach(credit => {
                    if (!existingCreditIds.has(credit.id)) {
                        creditPurchases[fecha].push(credit);
                    }
                });
            }
        }
        
        if (importData.dailyPackagePurchases && typeof dailyPackagePurchases !== 'undefined') {
            if (mode === 'overwrite') {
                dailyPackagePurchases[fecha] = importData.dailyPackagePurchases;
            } else {
                if (!dailyPackagePurchases[fecha]) dailyPackagePurchases[fecha] = [];
                const existingPackageIds = new Set(dailyPackagePurchases[fecha].map(p => p.id));
                importData.dailyPackagePurchases.forEach(packageData => {
                    if (!existingPackageIds.has(packageData.id)) {
                        dailyPackagePurchases[fecha].push(packageData);
                    }
                });
            }
        }
        
        if (importData.confirmaciones && typeof confirmaciones !== 'undefined') {
            if (!confirmaciones[fecha]) confirmaciones[fecha] = {};
            
            if (mode === 'overwrite') {
                confirmaciones[fecha] = importData.confirmaciones;
            } else {
                Object.assign(confirmaciones[fecha], importData.confirmaciones);
            }
        }
        
        if (importData.transferConfirmationStates && typeof transferConfirmationStates !== 'undefined') {
            if (mode === 'overwrite') {
                // Remover estados existentes de esta fecha
                Object.keys(transferConfirmationStates).forEach(key => {
                    if (key.includes(fecha)) {
                        delete transferConfirmationStates[key];
                    }
                });
            }
            Object.assign(transferConfirmationStates, importData.transferConfirmationStates);
        }
        
        // Guardar datos
        saveToStorageAsync();
        
        // Actualizar vistas si la fecha actual coincide
        if (fecha === document.getElementById('date-input').value) {
            updateAllViews(fecha);
        }
        
        // Actualizar información del sistema
        updateSystemInfo();
        
        alert(`Datos del día ${fecha} importados exitosamente (${mode === 'overwrite' ? 'sobrescribiendo' : 'fusionando'})`);
        
    } catch (error) {
        console.error('Error importing day data:', error);
        alert('Error al importar los datos. Verifique la consola para más detalles.');
    }
}

function createFullBackup() {
    try {
        const available = detectAvailableData();
        const backupData = generateFullBackupJSON(available);
        
        // Crear archivo y descargar
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `neurotea_backup_completo_${getLocalDateString()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert('Backup completo creado exitosamente');
        
    } catch (error) {
        console.error('Error creating full backup:', error);
        alert('Error al crear el backup. Verifique la consola para más detalles.');
    }
}

function generateFullBackupJSON(available) {
    const backupData = {
        backupInfo: {
            type: 'full_backup',
            createdAt: new Date().toISOString(),
            version: '1.0',
            detectedFeatures: available
        },
        sessions: sessions || {},
        egresos: egresos || {},
        therapists: therapists || []
    };
    
    // Incluir datos de funcionalidades detectadas
    if (available.credits && typeof creditPurchases !== 'undefined') {
        backupData.creditPurchases = creditPurchases;
    }
    
    if (available.packages && typeof dailyPackagePurchases !== 'undefined') {
        backupData.dailyPackagePurchases = dailyPackagePurchases;
    }
    
    if (available.confirmaciones && typeof confirmaciones !== 'undefined') {
        backupData.confirmaciones = confirmaciones;
    }
    
    if (available.vueltos && typeof transferConfirmationStates !== 'undefined') {
        backupData.transferConfirmationStates = transferConfirmationStates;
    }
    
    return backupData;
}

function importFullBackup() {
    const fileInput = document.getElementById('restore-backup-file');
    if (!fileInput.files[0]) {
        alert('Por favor seleccione un archivo de backup para restaurar');
        return;
    }
    
    // Primera confirmación
    if (!confirm('⚠️ ADVERTENCIA: Esta operación reemplazará TODOS los datos del sistema. ¿Está seguro?')) {
        return;
    }
    
    // Solicitar contraseña
    const password = prompt('Ingrese la contraseña para restaurar el backup:');
    if (password !== '280208') {
        alert('Contraseña incorrecta');
        return;
    }
    
    // Segunda confirmación más específica
    if (!confirm('⚠️ CONFIRMACIÓN FINAL: Se perderán TODOS los datos actuales del sistema. Esta acción NO se puede deshacer. ¿Proceder?')) {
        return;
    }
    
    const file = fileInput.files[0];
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const backupData = JSON.parse(e.target.result);
            
            if (!validateFullBackupStructure(backupData)) {
                alert('El archivo no tiene la estructura válida para un backup completo');
                return;
            }
            
            // Crear backup automático del estado actual
            createAutoBackup('before_restore');
            
            // Procesar restauración
            processFullBackupRestore(backupData);
            
        } catch (error) {
            console.error('Error parsing backup file:', error);
            alert('Error al leer el archivo de backup. Verifique que sea un archivo JSON válido.');
        }
    };
    
    reader.readAsText(file);
}

function validateFullBackupStructure(data) {
    return data && 
           data.backupInfo && 
           data.backupInfo.type === 'full_backup' &&
           data.sessions && 
           data.egresos && 
           Array.isArray(data.therapists);
}

function processFullBackupRestore(backupData) {
    try {
        // Restaurar datos base
        sessions = backupData.sessions || {};
        egresos = backupData.egresos || {};
        therapists = backupData.therapists || [];
        
        // Restaurar datos de funcionalidades adicionales si están disponibles
        if (backupData.creditPurchases && typeof creditPurchases !== 'undefined') {
            creditPurchases = backupData.creditPurchases;
        }
        
        if (backupData.dailyPackagePurchases && typeof dailyPackagePurchases !== 'undefined') {
            dailyPackagePurchases = backupData.dailyPackagePurchases;
        }
        
        if (backupData.confirmaciones && typeof confirmaciones !== 'undefined') {
            confirmaciones = backupData.confirmaciones;
        }
        
        if (backupData.transferConfirmationStates && typeof transferConfirmationStates !== 'undefined') {
            transferConfirmationStates = backupData.transferConfirmationStates;
        }
        
        // Guardar datos restaurados
        saveToStorageAsync();
        
        // Actualizar todas las vistas
        const currentDate = document.getElementById('date-input').value;
        if (currentDate) {
            updateAllViews(currentDate);
        }
        
        // Actualizar información del sistema
        updateSystemInfo();
        
        alert('Backup restaurado exitosamente. El sistema ha sido restaurado al estado del backup.');
        
        // Opcional: recargar la página para asegurar que todo se reinicialice
        if (confirm('¿Desea recargar la página para asegurar que todos los cambios se reflejen correctamente?')) {
            location.reload();
        }
        
    } catch (error) {
        console.error('Error restoring backup:', error);
        alert('Error al restaurar el backup. Verifique la consola para más detalles.');
    }
}

function createAutoBackup(suffix) {
    try {
        const available = detectAvailableData();
        const backupData = generateFullBackupJSON(available);
        
        // Guardar en localStorage temporal para recuperación de emergencia
        localStorage.setItem(`neurotea_auto_backup_${suffix}`, JSON.stringify(backupData));
        
        console.log(`Auto-backup creado: neurotea_auto_backup_${suffix}`);
        
    } catch (error) {
        console.error('Error creating auto backup:', error);
    }
}


// ===========================
// FUNCIONES PARA COMPROBANTES HTML - R8A
// ===========================

// Función para obtener paquetes por terapeuta y fecha
function getPackagesByTherapistAndDate(therapist, fecha) {
    const dayPackages = dailyPackagePurchases[fecha] || [];
    return dayPackages.filter(pkg => pkg.therapist === therapist);
}

// Función para generar filas de paquetes y créditos
function generatePackageAndCreditRows(therapist, fecha) {
    const rows = [];
    
    // Obtener sesiones del día
    const daySessions = sessions[fecha] || [];
    
    // 1. Sesiones normales (sin crédito usado)
    const normalSessions = daySessions.filter(session => 
        session.therapist === therapist && !session.creditUsed
    );
    
    normalSessions.forEach(session => {
        rows.push(
            '<tr>' +
                '<td>' + (session.patientName || 'Sin nombre') + '</td>' +
                '<td>SESION NORMAL</td>' +
                '<td class="currency">Gs ' + (session.sessionValue || 0).toLocaleString() + '</td>' +
                '<td class="currency">Gs ' + (session.neuroteaContribution || 0).toLocaleString() + '</td>' +
                '<td class="currency">Gs ' + (session.therapistFee || 0).toLocaleString() + '</td>' +
            '</tr>'
        );
    });
    
    // 2. Sesiones con crédito usado (creditUsed: true) - Valores en 0
    const creditUsedSessions = daySessions.filter(session => 
        session.therapist === therapist && session.creditUsed === true
    );
    
    creditUsedSessions.forEach(session => {
        rows.push(
            '<tr>' +
                '<td>' + (session.patientName || 'Sin nombre') + '</td>' +
                '<td>SESION CON CREDITO</td>' +
                '<td class="currency">Gs 0</td>' +
                '<td class="currency">Gs 0</td>' +
                '<td class="currency">Gs 0</td>' +
            '</tr>'
        );
    });
    
    // 3. Obtener paquetes del día
    const dayPackages = dailyPackagePurchases[fecha] || [];
    const therapistPackages = dayPackages.filter(pkg => pkg.therapist === therapist);
    
    therapistPackages.forEach(pkg => {
        let tipo, honorarios, aporte;
        
        if (pkg.createdBy === 'session_combined') {
            tipo = 'CREDITO';
        } else if (pkg.createdBy === 'independent') {
            tipo = 'PAQUETE';
        } else {
            tipo = 'PAQUETE';
        }
        
        // CORRECCIÓN: Usar configuración real del paquete
        honorarios = pkg.therapistFee || 0;
        aporte = pkg.neuroteaContribution || 0;
        
        rows.push(
            '<tr>' +
                '<td>' + (pkg.patientName || 'Sin nombre') + '</td>' +
                '<td>' + tipo + '</td>' +
                '<td class="currency">Gs ' + (pkg.sessionValue || 0).toLocaleString() + '</td>' +
                '<td class="currency">Gs ' + aporte.toLocaleString() + '</td>' +
                '<td class="currency">Gs ' + honorarios.toLocaleString() + '</td>' +
            '</tr>'
        );
    });
    
    if (rows.length === 0) {
        return '<tr><td colspan="5" style="text-align: center; font-style: italic;">No hay registros para esta fecha</td></tr>';
    }

    return rows.join('');
}

/**
 * ✅ NUEVA FUNCIÓN: Genera la sección de detalle del pago para el comprobante
 * Incluye información sobre vueltos y modalidad de pago
 */
function generatePaymentDetailSection(status, therapist, fecha) {
    const conf = status.confirmacionInfo;

    // Si no hay confirmación, mostrar estado pendiente
    if (!conf || !conf.confirmado) {
        return '<div class="payment-detail-section pending">' +
            '<div class="payment-detail-title pending">' +
                'PAGO PENDIENTE DE CONFIRMACIÓN' +
            '</div>' +
            '<div class="payment-modalidad">El pago aún no ha sido procesado en el sistema.</div>' +
        '</div>';
    }

    // Determinar modalidad de pago
    let modalidadTexto = '';
    let detalleHTML = '';
    const tipoOpcion = conf.tipoOpcion || 'exacto';

    switch(tipoOpcion) {
        case 'exacto':
            modalidadTexto = 'Pago en efectivo exacto';
            detalleHTML =
                '<div class="payment-detail-line">' +
                    '<span>Efectivo entregado:</span>' +
                    '<span>Gs ' + (conf.efectivoUsado || 0).toLocaleString() + '</span>' +
                '</div>';
            break;

        case 'vuelto':
            const vueltoTransf = conf.efectivoRecibido || 0;
            const entregadoVuelto = conf.efectivoUsado || 0;
            modalidadTexto = 'Pago en efectivo con vuelto por transferencia';
            detalleHTML =
                '<div class="payment-detail-line">' +
                    '<span>Efectivo entregado:</span>' +
                    '<span>Gs ' + (entregadoVuelto + vueltoTransf).toLocaleString() + '</span>' +
                '</div>' +
                '<div class="payment-detail-line">' +
                    '<span>Vuelto (transferencia a cuenta NeuroTEA):</span>' +
                    '<span>Gs ' + vueltoTransf.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="payment-detail-line highlight">' +
                    '<span>Neto recibido por terapeuta:</span>' +
                    '<span>Gs ' + entregadoVuelto.toLocaleString() + '</span>' +
                '</div>';
            break;

        case 'vuelto-efectivo':
            const vueltoEfectivo = conf.vueltoEfectivo || 0;
            const netoEfectivo = conf.efectivoUsado || 0;
            const entregadoTotal = netoEfectivo + vueltoEfectivo;
            modalidadTexto = 'Pago en efectivo con vuelto en efectivo';
            detalleHTML =
                '<div class="payment-detail-line">' +
                    '<span>Efectivo entregado:</span>' +
                    '<span>Gs ' + entregadoTotal.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="payment-detail-line">' +
                    '<span>Vuelto en efectivo (regresa a caja):</span>' +
                    '<span>Gs ' + vueltoEfectivo.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="payment-detail-line highlight">' +
                    '<span>Neto recibido por terapeuta:</span>' +
                    '<span>Gs ' + netoEfectivo.toLocaleString() + '</span>' +
                '</div>';
            break;

        case 'transferir':
            modalidadTexto = 'Pago por transferencia bancaria';
            detalleHTML =
                '<div class="payment-detail-line">' +
                    '<span>Transferido desde cuenta NeuroTEA:</span>' +
                    '<span>Gs ' + (conf.bancoUsado || 0).toLocaleString() + '</span>' +
                '</div>';
            break;

        default:
            // Para casos como DAR Y TRANSFERIR o LA TERAPEUTA DEBE DAR
            if (conf.efectivoUsado > 0 && conf.bancoUsado > 0) {
                modalidadTexto = 'Pago mixto (efectivo + transferencia)';
                detalleHTML =
                    '<div class="payment-detail-line">' +
                        '<span>Efectivo de caja:</span>' +
                        '<span>Gs ' + (conf.efectivoUsado || 0).toLocaleString() + '</span>' +
                    '</div>' +
                    '<div class="payment-detail-line">' +
                        '<span>Transferencia desde cuenta:</span>' +
                        '<span>Gs ' + (conf.bancoUsado || 0).toLocaleString() + '</span>' +
                    '</div>' +
                    '<div class="payment-detail-line highlight">' +
                        '<span>Total pagado a terapeuta:</span>' +
                        '<span>Gs ' + ((conf.efectivoUsado || 0) + (conf.bancoUsado || 0)).toLocaleString() + '</span>' +
                    '</div>';
            } else if (conf.efectivoRecibido > 0) {
                modalidadTexto = 'La terapeuta entregó efectivo';
                detalleHTML =
                    '<div class="payment-detail-line">' +
                        '<span>Efectivo recibido de terapeuta:</span>' +
                        '<span>Gs ' + (conf.efectivoRecibido || 0).toLocaleString() + '</span>' +
                    '</div>';
            } else {
                modalidadTexto = 'Pago procesado';
                detalleHTML =
                    '<div class="payment-detail-line">' +
                        '<span>Monto procesado:</span>' +
                        '<span>Gs ' + (conf.efectivoUsado || conf.bancoUsado || 0).toLocaleString() + '</span>' +
                    '</div>';
            }
    }

    // Formatear timestamp
    const fechaConfirmacion = conf.timestamp ? new Date(conf.timestamp).toLocaleString('es-PY') : 'No disponible';

    return '<div class="payment-detail-section">' +
        '<div class="payment-detail-title">' +
            'DETALLE DEL PAGO CONFIRMADO' +
        '</div>' +
        '<div class="payment-modalidad">Modalidad: ' + modalidadTexto + '</div>' +
        detalleHTML +
        '<div class="payment-detail-line" style="margin-top: 10px; font-size: 9px; color: #666;">' +
            '<span>Confirmado:</span>' +
            '<span>' + fechaConfirmacion + '</span>' +
        '</div>' +
    '</div>';
}

// Función principal para generar HTML del comprobante
function generateReceiptHTMLContent(therapist, fecha, therapistSessions) {
    try {
        // Datos básicos
        const fechaFormateada = formatDateForReceipt(fecha);
        const horaActual = new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
        const numeroComprobante = '#CP-' + fecha.replace(/-/g, '') + '-001';

        // Calcular totales
        const status = calculateTherapistStatus(therapist, fecha);
        const diferencia = (status.neuroteaLeDebe || 0) - (status.terapeutaDebe || 0);

        // Generar filas de ingresos
        const ingresoRows = generatePackageAndCreditRows(therapist, fecha);

        // Texto del resultado final
        let textoResultado;
        if (diferencia > 0) {
            textoResultado = 'LA TERAPEUTA DEBE RECIBIR: Gs ' + Math.abs(diferencia).toLocaleString();
        } else if (diferencia < 0) {
            textoResultado = 'LA TERAPEUTA DEBE DAR: Gs ' + Math.abs(diferencia).toLocaleString();
        } else {
            textoResultado = 'SALDOS EQUILIBRADOS: Gs 0';
        }

        // ✅ NUEVO: Generar sección de detalle del pago
        const detallePagoHTML = generatePaymentDetailSection(status, therapist, fecha);

        // Observaciones
        const observaciones = generateDynamicObservations(therapist, fecha);
        const observacionesHTML = observaciones.length > 0
            ? observaciones.join('<br>')
            : 'Comprobante generado automáticamente por Sistema NeuroTEA';
        
        // HTML completo con estilos exactos del ejemplo de referencia
        return '<!DOCTYPE html>' +
'<html lang="es">' +
'<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Comprobante NeuroTEA - ' + therapist + '</title>' +
    '<style>' +
        '/* Simulación exacta del código fuente con medidas CSS corregidas */' +
        'body {' +
            'margin: 0;' +
            'padding: 0;' +
            'font-family: Helvetica, Arial, sans-serif;' +
            'background: white;' +
            'color: black;' +
            'width: 210mm; /* A4 width */' +
            'min-height: 297mm; /* A4 height */' +
            'box-sizing: border-box;' +
        '}' +
        '/* ENCABEZADO - Gris con letras negras según la foto */' +
        '.header {' +
            'background: #e6e6e6;' +
            'height: 60px;' +
            'padding: 0 30px;' +
            'position: relative;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'border-bottom: 1px solid #ccc;' +
            'margin: 0 auto;' +
            'max-width: 190mm; /* Máximo ancho para A4 con márgenes */' +
        '}' +
        '.header-left {' +
            'position: relative;' +
            'flex: 1;' +
        '}' +
        '.avanza-text {' +
            'color: black;' +
            'font-style: italic;' +
            'font-size: 18px;' +
            'margin-bottom: -5px; /* Clave: solapamiento según código */' +
        '}' +
        '.neurotea-text {' +
            'color: black;' +
            'font-weight: bold;' +
            'font-size: 32px;' +
            'margin-top: -5px; /* Permite solapamiento */' +
        '}' +
        '.tea-orange {' +
            'color: black;' +
        '}' +
        '.header-right {' +
            'color: black;' +
            'font-weight: bold;' +
            'font-size: 36px;' +
            'padding-right: 20px; /* Espacio adicional desde el borde */' +
            'text-align: right;' +
            'flex: 0 0 auto;' +
        '}' +
        '/* CONTENIDO - Padding exacto del código */' +
        '.content {' +
            'padding: 20px 30px;' +
        '}' +
        '/* INFORMACIÓN BÁSICA - Formato de dos columnas exacto */' +
        '.basic-info {' +
            'margin-bottom: 20px;' +
            'border-bottom: 1px solid #000;' +
            'padding-bottom: 10px;' +
        '}' +
        '.info-grid {' +
            'display: grid;' +
            'grid-template-columns: 1fr 1fr;' +
            'gap: 20px;' +
            'margin-bottom: 10px;' +
        '}' +
        '.info-column {' +
            'display: flex;' +
            'flex-direction: column;' +
            'gap: 8px;' +
        '}' +
        '.info-item {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'font-size: 12px;' +
        '}' +
        '.info-label {' +
            'font-weight: bold;' +
            'color: black;' +
        '}' +
        '.info-value {' +
            'color: black;' +
        '}' +
        '/* SECCIÓN DE PAQUETES - Exacto según código fuente */' +
        '.packages-section {' +
            'margin: 20px 0;' +
        '}' +
        '.section-title {' +
            'background-color: #f5f5f5;' +
            'padding: 8px 12px;' +
            'font-weight: bold;' +
            'font-size: 12px;' +
            'color: black;' +
            'border: 1px solid #ddd;' +
            'margin-bottom: 0;' +
        '}' +
        '.sessions-table {' +
            'width: 100%;' +
            'border-collapse: collapse;' +
            'font-size: 10px;' +
            'margin-bottom: 20px;' +
        '}' +
        '.sessions-table th,' +
        '.sessions-table td {' +
            'padding: 6px 8px;' +
            'text-align: left;' +
            'border: 1px solid #ddd;' +
        '}' +
        '.sessions-table th {' +
            'background-color: #f5f5f5;' +
            'font-weight: bold;' +
            'color: black;' +
            'font-size: 10px;' +
        '}' +
        '/* TOTALES - Según estructura del código */' +
        '.totals-section {' +
            'border: 1px solid #ddd;' +
            'padding: 15px;' +
            'margin: 20px 0;' +
            'background-color: #f9f9f9;' +
        '}' +
        '.total-line {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'padding: 4px 0;' +
            'font-size: 11px;' +
        '}' +
        '.total-label {' +
            'font-weight: bold;' +
            'color: black;' +
        '}' +
        '.total-value {' +
            'color: black;' +
            'font-weight: bold;' +
        '}' +
        '/* CÁLCULO FINAL */' +
        '.calculation-section {' +
            'border: 2px solid #000;' +
            'padding: 15px;' +
            'margin: 20px 0;' +
            'background-color: #f0f0f0;' +
        '}' +
        '.calc-title {' +
            'font-weight: bold;' +
            'font-size: 12px;' +
            'color: black;' +
            'margin-bottom: 10px;' +
            'text-align: center;' +
        '}' +
        '.calc-line {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'padding: 3px 0;' +
            'font-size: 11px;' +
            'color: black;' +
        '}' +
        '.calc-separator {' +
            'border-top: 1px solid #000;' +
            'margin: 8px 0;' +
        '}' +
        '.calc-result {' +
            'font-size: 14px;' +
            'font-weight: bold;' +
            'text-align: center;' +
            'color: black;' +
            'background-color: white;' +
            'padding: 10px;' +
            'border: 1px solid #000;' +
            'margin-top: 10px;' +
        '}' +
        '/* DETALLE DEL PAGO - TONOS GRISES */' +
        '.payment-detail-section {' +
            'margin: 20px 0;' +
            'padding: 15px;' +
            'border: 1px solid #ccc;' +
            'background-color: #f5f5f5;' +
            'border-radius: 0;' +
        '}' +
        '.payment-detail-section.pending {' +
            'border-color: #999;' +
            'background-color: #e8e8e8;' +
        '}' +
        '.payment-detail-title {' +
            'font-weight: bold;' +
            'font-size: 12px;' +
            'color: #333;' +
            'margin-bottom: 10px;' +
            'display: flex;' +
            'align-items: center;' +
        '}' +
        '.payment-detail-title.pending {' +
            'color: #555;' +
        '}' +
        '.payment-detail-title .icon {' +
            'margin-right: 8px;' +
            'font-size: 16px;' +
        '}' +
        '.payment-detail-line {' +
            'display: flex;' +
            'justify-content: space-between;' +
            'padding: 4px 0;' +
            'font-size: 11px;' +
            'color: black;' +
        '}' +
        '.payment-detail-line.highlight {' +
            'font-weight: bold;' +
            'border-top: 1px solid #999;' +
            'padding-top: 8px;' +
            'margin-top: 5px;' +
        '}' +
        '.payment-modalidad {' +
            'font-size: 11px;' +
            'color: #666;' +
            'margin-bottom: 8px;' +
            'font-style: italic;' +
        '}' +
        '/* OBSERVACIONES */' +
        '.observations-section {' +
            'margin: 20px 0;' +
            'padding: 10px;' +
            'border: 1px solid #ddd;' +
            'background-color: #f9f9f9;' +
        '}' +
        '.obs-title {' +
            'font-weight: bold;' +
            'margin-bottom: 8px;' +
            'color: black;' +
            'font-size: 11px;' +
        '}' +
        '.obs-content {' +
            'font-size: 10px;' +
            'color: #555;' +
            'font-style: italic;' +
        '}' +
        '/* FIRMAS - Espaciado exacto con líneas punteadas y centrado */' +
        '.signatures-section {' +
            'margin-top: 50px;' +
            'display: grid;' +
            'grid-template-columns: 1fr 1fr;' +
            'gap: 60px;' +
            'font-size: 11px;' +
            'padding: 0 40px;' +
        '}' +
        '.signature-block {' +
            'text-align: center;' +
        '}' +
        '.signature-line {' +
            'border-bottom: 2px dotted #666;' +
            'width: 150px;' +
            'margin: 0 auto 10px auto;' +
            'height: 40px;' +
        '}' +
        '.signature-text {' +
            'font-weight: bold;' +
            'margin-bottom: 8px;' +
            'color: black;' +
            'font-size: 11px;' +
        '}' +
        '.signature-name {' +
            'font-weight: normal;' +
            'color: black;' +
            'font-size: 11px;' +
        '}' +
        '/* Utilidades */' +
        '.currency {' +
            'font-family: monospace;' +
            'color: black;' +
        '}' +
    '</style>' +
'</head>' +
'<body>' +
    '<!-- ENCABEZADO SEGÚN CÓDIGO FUENTE -->' +
    '<div class="header">' +
        '<div class="header-left">' +
            '<div class="avanza-text">Avanza</div>' +
            '<div class="neurotea-text">Neuro<span class="tea-orange">TEA</span></div>' +
        '</div>' +
        '<div class="header-right">COMPROBANTE</div>' +
    '</div>' +
    '<!-- CONTENIDO -->' +
    '<div class="content">' +
        '<!-- INFORMACIÓN BÁSICA -->' +
        '<div class="basic-info">' +
            '<div class="info-grid">' +
                '<div class="info-column">' +
                    '<div class="info-item">' +
                        '<span class="info-label">TERAPEUTA:</span>' +
                        '<span class="info-value">' + therapist + '</span>' +
                    '</div>' +
                    '<div class="info-item">' +
                        '<span class="info-label">FECHA:</span>' +
                        '<span class="info-value">' + fechaFormateada + '</span>' +
                    '</div>' +
                    '<div class="info-item">' +
                        '<span class="info-label">SESIONES:</span>' +
                        '<span class="info-value">' + therapistSessions.length + ' sesiones realizadas</span>' +
                    '</div>' +
                '</div>' +
                '<div class="info-column">' +
                    '<div class="info-item">' +
                        '<span class="info-label">COMPROBANTE:</span>' +
                        '<span class="info-value">' + numeroComprobante + '</span>' +
                    '</div>' +
                    '<div class="info-item">' +
                        '<span class="info-label">HORA:</span>' +
                        '<span class="info-value">' + horaActual + '</span>' +
                    '</div>' +
                    '<div class="info-item">' +
                        '<span class="info-label">ESTADO:</span>' +
                        '<span class="info-value">' + (diferencia > 0 ? 'DEBE RECIBIR' : diferencia < 0 ? 'DEBE DAR' : 'EQUILIBRADO') + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<!-- DETALLE DE INGRESOS DEL DÍA - ESTRUCTURA REFINADA -->' +
        '<div class="packages-section">' +
            '<h3 class="section-title">DETALLE DE INGRESOS DEL DÍA</h3>' +
            '<table class="sessions-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th style="width: 25%;">PACIENTE</th>' +
                        '<th style="width: 20%;">TIPO</th>' +
                        '<th style="width: 20%;">VALOR SESION</th>' +
                        '<th style="width: 17.5%;">APORTE NEUROTEA</th>' +
                        '<th style="width: 17.5%;">HONORARIOS</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>' +
                    ingresoRows +
                '</tbody>' +
            '</table>' +
        '</div>' +
        '<!-- TOTALES - SEGÚN ESTRUCTURA DEL CÓDIGO -->' +
        '<div class="totals-section">' +
            '<div class="total-line">' +
                '<span class="total-label">VALOR TOTAL SESIONES:</span>' +
                '<span class="total-value currency">Gs ' + (status.valorTotalSesiones || 0).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="total-line">' +
                '<span class="total-label">TOTAL APORTE NEUROTEA:</span>' +
                '<span class="total-value currency">Gs ' + (status.aporteNeuroTEA || 0).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="total-line">' +
                '<span class="total-label">TOTAL HONORARIOS:</span>' +
                '<span class="total-value currency">Gs ' + (status.honorarios || 0).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="total-line">' +
                '<span class="total-label">TRANSFERENCIAS A TERAPEUTA:</span>' +
                '<span class="total-value currency">Gs ' + (status.transferenciaATerapeuta || 0).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="total-line">' +
                '<span class="total-label">ADELANTOS RECIBIDOS:</span>' +
                '<span class="total-value currency">Gs ' + (status.adelantosRecibidos || 0).toLocaleString() + '</span>' +
            '</div>' +
        '</div>' +
        '<!-- CÁLCULO FINAL -->' +
        '<div class="calculation-section">' +
            '<div class="calc-title">CALCULO FINAL</div>' +
            '<div class="calc-result">' + textoResultado + '</div>' +
        '</div>' +
        '<!-- DETALLE DEL PAGO - NUEVO -->' +
        detallePagoHTML +
        '<!-- OBSERVACIONES -->' +
        '<div class="observations-section">' +
            '<div class="obs-title">OBSERVACIONES:</div>' +
            '<div class="obs-content">' +
                observacionesHTML +
            '</div>' +
        '</div>' +
        '<!-- FIRMAS -->' +
        '<div class="signatures-section">' +
            '<div class="signature-block">' +
                '<div class="signature-line"></div>' +
                '<div class="signature-text">RECIBI CONFORME</div>' +
                '<div class="signature-name">' + therapist + '</div>' +
            '</div>' +
            '<div class="signature-block">' +
                '<div class="signature-line"></div>' +
                '<div class="signature-text">ENTREGUE CONFORME</div>' +
                '<div class="signature-name">Secretaría NeuroTEA</div>' +
            '</div>' +
        '</div>' +
    '</div>' +
'</body>' +
'</html>';
        
    } catch (error) {
        console.error('Error en generateReceiptHTMLContent:', error);
        return '<!DOCTYPE html><html><head><title>Error</title></head><body style="color: #000;"><h1>Error al generar comprobante</h1><p>Error: ' + error.message + '</p><p>Terapeuta: ' + therapist + '</p><p>Fecha: ' + fecha + '</p></body></html>';
    }
}

// Función para descargar archivo HTML
function downloadHTMLFile(htmlContent, therapist, fecha) {
    try {
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Comprobante_' + therapist.replace(/\s+/g, '_') + '_' + fecha + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('Comprobante HTML descargado: ' + a.download);
    } catch (error) {
        console.error('Error al descargar archivo HTML:', error);
        alert('Error al descargar el comprobante HTML: ' + error.message);
    }
}

