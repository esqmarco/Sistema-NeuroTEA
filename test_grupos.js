// ================================================
// SCRIPT DE PRUEBAS - SISTEMA DE SESIONES GRUPALES
// Copiar y pegar en la consola del navegador (F12)
// ================================================

console.log('🧪 Iniciando pruebas del sistema de grupos...\n');

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
            tests.results.push(`✅ ${name}`);
            console.log(`✅ ${name}`);
        } else {
            tests.failed++;
            tests.results.push(`❌ ${name}: ${result}`);
            console.log(`❌ ${name}: ${result}`);
        }
    } catch (error) {
        tests.failed++;
        tests.results.push(`❌ ${name}: ${error.message}`);
        console.log(`❌ ${name}: ${error.message}`);
    }
}

// ============================================
// PRUEBAS DE VARIABLES GLOBALES
// ============================================
console.log('\n📦 VARIABLES GLOBALES:');

test('groupTherapy existe', () => typeof groupTherapy !== 'undefined');
test('groupSessions existe', () => typeof groupSessions !== 'undefined');
test('groupTherapyHistory existe', () => typeof groupTherapyHistory !== 'undefined');
test('groupSessionTemp existe', () => typeof groupSessionTemp !== 'undefined');

// ============================================
// PRUEBAS DE FUNCIONES CRUD
// ============================================
console.log('\n🔧 FUNCIONES CRUD:');

test('createGroup existe', () => typeof createGroup === 'function');
test('addChildToGroup existe', () => typeof addChildToGroup === 'function');
test('removeChildFromGroup existe', () => typeof removeChildFromGroup === 'function');
test('editChildInGroup existe', () => typeof editChildInGroup === 'function');
test('deleteGroup existe', () => typeof deleteGroup === 'function');

// ============================================
// PRUEBAS DE FUNCIONES DE SESIÓN
// ============================================
console.log('\n📝 FUNCIONES DE SESIÓN:');

test('initGroupSessionForm existe', () => typeof initGroupSessionForm === 'function');
test('calculateGroupSessionValues existe', () => typeof calculateGroupSessionValues === 'function');
test('registerGroupSession existe', () => typeof registerGroupSession === 'function');
test('deleteGroupSession existe', () => typeof deleteGroupSession === 'function');
test('validateGroupSessionButton existe', () => typeof validateGroupSessionButton === 'function');

// ============================================
// PRUEBAS DE FUNCIONES UI
// ============================================
console.log('\n🎨 FUNCIONES UI:');

test('toggleGroupSessionForm existe', () => typeof toggleGroupSessionForm === 'function');
test('openGroupManagement existe', () => typeof openGroupManagement === 'function');
test('closeGroupManagementModal existe', () => typeof closeGroupManagementModal === 'function');
test('renderGroupList existe', () => typeof renderGroupList === 'function');
test('populateGroupSelect existe', () => typeof populateGroupSelect === 'function');

// ============================================
// PRUEBAS DE ELEMENTOS HTML
// ============================================
console.log('\n🏗️ ELEMENTOS HTML:');

test('group-session-form-content existe', () => !!document.getElementById('group-session-form-content'));
test('group-select existe', () => !!document.getElementById('group-select'));
test('group-attendance-section existe', () => !!document.getElementById('group-attendance-section'));
test('group-therapists-section existe', () => !!document.getElementById('group-therapists-section'));
test('group-values-section existe', () => !!document.getElementById('group-values-section'));
test('register-group-btn existe', () => !!document.getElementById('register-group-btn'));
test('group-management-modal existe', () => !!document.getElementById('group-management-modal'));
test('edit-group-modal existe', () => !!document.getElementById('edit-group-modal'));
test('group-cash-neurotea existe', () => !!document.getElementById('group-cash-neurotea'));
test('group-transfer-neurotea existe', () => !!document.getElementById('group-transfer-neurotea'));

// ============================================
// PRUEBAS FUNCIONALES
// ============================================
console.log('\n🔬 PRUEBAS FUNCIONALES:');

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

// Agregar niño al grupo
test('Agregar niño al grupo', () => {
    const testGroupId = Object.keys(groupTherapy).find(k => k.startsWith('test-grupo-'));
    if (!testGroupId) return 'No se encontró grupo de prueba';

    const childId = `child-${Date.now()}`;
    groupTherapy[testGroupId].children.push({
        id: childId,
        name: 'Niño Test',
        amount: 150000
    });

    return groupTherapy[testGroupId].children.length === 1;
});

// Calcular valores de sesión
test('Calcular valores de sesión grupal', () => {
    const testGroupId = Object.keys(groupTherapy).find(k => k.startsWith('test-grupo-'));
    if (!testGroupId) return 'No se encontró grupo de prueba';

    // Configurar groupSessionTemp
    groupSessionTemp.groupId = testGroupId;
    groupSessionTemp.attendance = [{
        childId: groupTherapy[testGroupId].children[0].id,
        childName: 'Niño Test',
        amount: 150000,
        present: true
    }];
    groupSessionTemp.therapists = ['Terapeuta Test'];

    const values = calculateGroupSessionValues();

    // Verificar cálculos (30% de 150000 = 45000)
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
console.log('📊 RESUMEN DE PRUEBAS');
console.log('='.repeat(50));
console.log(`✅ Pasadas: ${tests.passed}`);
console.log(`❌ Falladas: ${tests.failed}`);
console.log(`📈 Total: ${tests.passed + tests.failed}`);
console.log(`📉 Porcentaje: ${Math.round(tests.passed / (tests.passed + tests.failed) * 100)}%`);

if (tests.failed > 0) {
    console.log('\n⚠️ PRUEBAS FALLADAS:');
    tests.results.filter(r => r.startsWith('❌')).forEach(r => console.log(r));
} else {
    console.log('\n🎉 ¡TODAS LAS PRUEBAS PASARON!');
}

// Retornar resultados para análisis
tests;
