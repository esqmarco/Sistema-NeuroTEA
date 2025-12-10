// ================================================
// SCRIPT DE PRUEBAS - SISTEMA DE SESIONES GRUPALES
// Nueva UI con Modal
// Copiar y pegar en la consola del navegador (F12)
// ================================================

console.log('Iniciando pruebas del sistema de grupos (nueva UI)...\n');

const tests = {
    passed: 0,
    failed: 0,
    results: []
};

function test(name, fn) {
    try {
        const result = fn();
        if (result === true || result === undefined) {
            tests.passed++;
            tests.results.push(`PASS ${name}`);
            console.log(`PASS ${name}`);
        } else {
            tests.failed++;
            tests.results.push(`FAIL ${name}: ${result}`);
            console.log(`FAIL ${name}: ${result}`);
        }
    } catch (error) {
        tests.failed++;
        tests.results.push(`FAIL ${name}: ${error.message}`);
        console.log(`FAIL ${name}: ${error.message}`);
    }
}

// ============================================
// PRUEBAS DE VARIABLES GLOBALES
// ============================================
console.log('\n[VARIABLES GLOBALES]');

test('groupTherapy existe', () => typeof groupTherapy !== 'undefined');
test('groupSessions existe', () => typeof groupSessions !== 'undefined');
test('groupTherapyHistory existe', () => typeof groupTherapyHistory !== 'undefined');
test('groupSessionTemp existe', () => typeof groupSessionTemp !== 'undefined');

// ============================================
// PRUEBAS DE FUNCIONES CRUD
// ============================================
console.log('\n[FUNCIONES CRUD]');

test('createGroup existe', () => typeof createGroup === 'function');
test('addChildToGroup existe', () => typeof addChildToGroup === 'function');
test('removeChildFromGroup existe', () => typeof removeChildFromGroup === 'function');
test('editChildInGroup existe', () => typeof editChildInGroup === 'function');
test('deleteGroup existe', () => typeof deleteGroup === 'function');

// ============================================
// PRUEBAS DE FUNCIONES DE SESION MODAL
// ============================================
console.log('\n[FUNCIONES DE MODAL]');

test('openGroupSessionModal existe', () => typeof openGroupSessionModal === 'function');
test('closeGroupSessionModal existe', () => typeof closeGroupSessionModal === 'function');
test('onGroupSelectChange existe', () => typeof onGroupSelectChange === 'function');
test('updateGroupSessionValues existe', () => typeof updateGroupSessionValues === 'function');
test('updateGroupPaymentTotals existe', () => typeof updateGroupPaymentTotals === 'function');
test('calculateGroupSessionValues existe', () => typeof calculateGroupSessionValues === 'function');
test('registerGroupSession existe', () => typeof registerGroupSession === 'function');
test('deleteGroupSession existe', () => typeof deleteGroupSession === 'function');
test('validateGroupSessionButton existe', () => typeof validateGroupSessionButton === 'function');

// ============================================
// PRUEBAS DE FUNCIONES UI GESTION
// ============================================
console.log('\n[FUNCIONES UI GESTION]');

test('openGroupManagement existe', () => typeof openGroupManagement === 'function');
test('closeGroupManagementModal existe', () => typeof closeGroupManagementModal === 'function');
test('renderGroupList existe', () => typeof renderGroupList === 'function');
test('populateGroupSelect existe', () => typeof populateGroupSelect === 'function');
test('toggleGroupSection existe', () => typeof toggleGroupSection === 'function');

// ============================================
// PRUEBAS DE ELEMENTOS HTML - MODAL DE REGISTRO
// ============================================
console.log('\n[ELEMENTOS HTML - MODAL DE REGISTRO]');

test('group-session-modal existe', () => !!document.getElementById('group-session-modal'));
test('group-select existe', () => !!document.getElementById('group-select'));
test('group-attendance-section existe', () => !!document.getElementById('group-attendance-section'));
test('group-therapists-section existe', () => !!document.getElementById('group-therapists-section'));
test('group-values-section existe', () => !!document.getElementById('group-values-section'));
test('group-payment-section existe', () => !!document.getElementById('group-payment-section'));
test('group-cash-neurotea existe', () => !!document.getElementById('group-cash-neurotea'));
test('group-transfer-neurotea existe', () => !!document.getElementById('group-transfer-neurotea'));
test('register-group-btn existe', () => !!document.getElementById('register-group-btn'));

// ============================================
// PRUEBAS DE ELEMENTOS HTML - MODAL DE GESTION
// ============================================
console.log('\n[ELEMENTOS HTML - MODAL DE GESTION]');

test('group-management-modal existe', () => !!document.getElementById('group-management-modal'));
test('edit-group-modal existe', () => !!document.getElementById('edit-group-modal'));
test('new-group-name input existe', () => !!document.getElementById('new-group-name'));
test('new-group-percentage input existe', () => !!document.getElementById('new-group-percentage'));

// ============================================
// PRUEBAS DE ELEMENTOS HTML - MODO DE REGISTRO
// ============================================
console.log('\n[ELEMENTOS HTML - MODO DE REGISTRO]');

test('modo-sesion-grupal radio existe', () => !!document.getElementById('modo-sesion-grupal'));

// ============================================
// PRUEBAS FUNCIONALES
// ============================================
console.log('\n[PRUEBAS FUNCIONALES]');

// Crear grupo de prueba
test('Crear grupo de prueba', () => {
    const testGroupId = `test-grupo-${Date.now()}`;
    groupTherapy[testGroupId] = {
        id: testGroupId,
        name: 'Grupo Test',
        children: [],
        totalMaxValue: 0,
        neuroteaPercentage: 30,
        createdAt: new Date().toISOString(),
        status: 'active'
    };
    return groupTherapy[testGroupId] !== undefined;
});

// Agregar nino al grupo
test('Agregar nino al grupo', () => {
    const testGroupId = Object.keys(groupTherapy).find(k => k.startsWith('test-grupo-'));
    if (!testGroupId) return 'No se encontro grupo de prueba';

    const childId = `child-${Date.now()}`;
    groupTherapy[testGroupId].children.push({
        id: childId,
        name: 'Nino Test',
        amount: 150000
    });

    return groupTherapy[testGroupId].children.length === 1;
});

// Calcular valores de sesion
test('Calcular valores de sesion grupal', () => {
    const testGroupId = Object.keys(groupTherapy).find(k => k.startsWith('test-grupo-'));
    if (!testGroupId) return 'No se encontro grupo de prueba';

    // Configurar groupSessionTemp
    groupSessionTemp.groupId = testGroupId;
    groupSessionTemp.attendance = [{
        childId: groupTherapy[testGroupId].children[0].id,
        childName: 'Nino Test',
        amount: 150000,
        present: true
    }];
    groupSessionTemp.therapists = ['Terapeuta Test'];

    const values = calculateGroupSessionValues();

    // Verificar calculos (30% de 150000 = 45000)
    if (values.totalValue !== 150000) return `Total incorrecto: ${values.totalValue}`;
    if (values.neuroteaContribution !== 45000) return `Aporte incorrecto: ${values.neuroteaContribution}`;
    if (values.feePerTherapist !== 105000) return `Fee incorrecto: ${values.feePerTherapist}`;

    return true;
});

// Limpiar grupo de prueba
test('Eliminar grupo de prueba', () => {
    const testGroupId = Object.keys(groupTherapy).find(k => k.startsWith('test-grupo-'));
    if (testGroupId) {
        delete groupTherapy[testGroupId];
    }
    // Limpiar temp
    groupSessionTemp.groupId = null;
    groupSessionTemp.attendance = [];
    groupSessionTemp.therapists = [];
    return true;
});

// ============================================
// RESUMEN
// ============================================
console.log('\n' + '='.repeat(50));
console.log('RESUMEN DE PRUEBAS');
console.log('='.repeat(50));
console.log(`Pasadas: ${tests.passed}`);
console.log(`Falladas: ${tests.failed}`);
console.log(`Total: ${tests.passed + tests.failed}`);
console.log(`Porcentaje: ${Math.round(tests.passed / (tests.passed + tests.failed) * 100)}%`);

if (tests.failed > 0) {
    console.log('\nPRUEBAS FALLADAS:');
    tests.results.filter(r => r.startsWith('FAIL')).forEach(r => console.log(r));
} else {
    console.log('\n TODAS LAS PRUEBAS PASARON!');
}

// Retornar resultados para analisis
tests;
