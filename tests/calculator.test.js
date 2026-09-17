'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'calculator.js'), 'utf8');

function element(dataset = {}) {
    const classes = new Set();
    const listeners = new Map();
    const attributes = new Map();
    return {
        value: '', textContent: '', style: {}, dataset,
        hidden: false, disabled: false, readOnly: true,
        tagName: 'INPUT', scrollLeft: 0, scrollWidth: 100,
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
            toggle(name, force) {
                const enabled = force === undefined ? !classes.has(name) : force;
                if (enabled) classes.add(name); else classes.delete(name);
                return enabled;
            },
        },
        setAttribute: (name, value) => attributes.set(name, String(value)),
        removeAttribute: name => attributes.delete(name),
        getAttribute: name => attributes.get(name) ?? null,
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
        dispatchEvent(event) {
            for (const callback of listeners.get(event.type) || []) callback(event);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => true,
        closest(selector) { return selector === 'button' && this.tagName === 'BUTTON' ? this : null; },
        focus() {},
    };
}

function calculator() {
    const elements = new Map();
    const listeners = new Map();
    const container = element();
    const buttons = ['+', '-', '*', '/', 'pow', 'sqrty'].map(value => {
        const button = element({ action: ['pow', 'sqrty'].includes(value) ? value : 'operator', value });
        button.tagName = 'BUTTON';
        return button;
    });
    const document = {
        readyState: 'loading', activeElement: null,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, element());
            return elements.get(id);
        },
        querySelector: selector => selector === '.calculator' ? container : null,
        querySelectorAll: () => buttons,
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
    };
    const context = vm.createContext({
        document, console,
        requestAnimationFrame: callback => callback(),
        setTimeout: callback => callback(), clearTimeout() {},
    });
    context.window = context;
    vm.runInContext(source, context, { filename: 'calculator.js' });
    document.readyState = 'complete';
    for (const callback of listeners.get('DOMContentLoaded') || []) callback();

    return {
        call(name, ...args) { return context[name](...args); },
        get current() { return vm.runInContext('state.current', context); },
        get history() { return vm.runInContext('state.history', context); },
        get error() { return vm.runInContext('state.error', context); },
        get display() { return document.getElementById('Display').value; },
        get expression() { return document.getElementById('preDisplay').value; },
        get displayedHistory() { return document.getElementById('hisDisplay').value; },
        key(key, options = {}) {
            const event = {
                key, target: { tagName: 'BUTTON' },
                ctrlKey: false, metaKey: false, altKey: false, isComposing: false,
                defaultPrevented: false,
                preventDefault() { this.defaultPrevented = true; },
                ...options,
            };
            document.activeElement = event.target;
            for (const callback of listeners.get('keydown') || []) callback(event);
            return event;
        },
        type(number) {
            const text = String(number);
            if (text.startsWith('-')) this.call('negate');
            for (const digit of text.replace(/^-/, '')) {
                this.call(digit === '.' ? 'inputDecimal' : 'inputDigit', digit);
            }
            return this;
        },
        operator(operation) {
            this.call(['pow', 'sqrty'].includes(operation) ? 'doScientific' : 'setOperator', operation);
            return this;
        },
        equals() { this.call('equalsPressed'); return this; },
    };
}

function resultIs(calc, expected) {
    assert.equal(calc.error, null);
    assert.equal(calc.current, String(expected));
    assert.equal(calc.display, String(expected), 'main display is synchronized');
}

function historyEndsWith(calc, result) {
    assert.match(calc.history, new RegExp(`=\\s*${String(result).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    assert.equal(calc.displayedHistory, calc.history, 'history display is synchronized');
}

function seedHistory(calc) {
    calc.type(2).operator('+').type(3).equals();
    const history = calc.history;
    assert.ok(history.length > 0);
    calc.call('clearAll');
    return history;
}

test('initial screen shows zero and empty history', () => {
    const calc = calculator();
    resultIs(calc, 0);
    assert.equal(calc.history, '');
    assert.equal(calc.displayedHistory, '');
});

for (const [operation, expected] of [['+', 10], ['-', 6], ['*', 16], ['/', 4]]) {
    test(`basic ${operation} replaces the first operand when entering the second`, () => {
        const calc = calculator();
        calc.type(8).operator(operation).type(2);
        resultIs(calc, 2);
        assert.ok(calc.expression.includes('8'), 'pending expression retains the first operand');
        calc.equals();
        resultIs(calc, expected);
        historyEndsWith(calc, expected);
        assert.match(calc.history, /8/);
        assert.match(calc.history, /2/);
    });
}

test('immediate execution records the intermediate and final completed calculations', () => {
    const calc = calculator();
    calc.type(2).operator('+').type(3).operator('*');
    historyEndsWith(calc, 5);
    assert.match(calc.history, /2\s*\+\s*3/);
    calc.type(4).equals();
    resultIs(calc, 20);
    historyEndsWith(calc, 20);
    assert.match(calc.history, /5\s*[×*]\s*4/);
    assert.doesNotMatch(calc.history, /2\s*\+\s*3/);
});

test('scientific and basic binary operations share chaining', () => {
    const calc = calculator();
    calc.type(2).operator('+').type(3).operator('pow').type(2).equals();
    resultIs(calc, 25);
    historyEndsWith(calc, 25);
    calc.call('clearAll');
    calc.type(2).operator('pow').type(3).operator('+').type(4).equals();
    resultIs(calc, 12);
    calc.call('clearAll');
    calc.type(27).operator('sqrty').type(3).operator('*').type(4).equals();
    resultIs(calc, 12);
});

test('replacing pending operators does not calculate with a missing second operand', () => {
    const calc = calculator();
    calc.type(8).operator('+').operator('*');
    assert.equal(calc.history, '');
    calc.type(2).equals();
    resultIs(calc, 16);
    calc.call('clearAll');
    calc.type(8).operator('pow').operator('+').type(2).equals();
    resultIs(calc, 10);
    calc.call('clearAll');
    calc.type(8).operator('+').operator('sqrty').type(3).equals();
    resultIs(calc, 2);
});

for (const operation of ['+', 'pow', 'sqrty']) {
    test(`equals and unary actions without a right operand preserve pending ${operation}`, () => {
        const calc = calculator();
        calc.type(9).operator(operation);
        const before = calc.current;
        calc.equals();
        calc.call('doScientific', 'square');
        calc.call('percent');
        assert.equal(calc.error, null);
        assert.equal(calc.current, before);
        assert.equal(calc.history, '');
        calc.type(2).equals();
        resultIs(calc, operation === '+' ? 11 : operation === 'pow' ? 81 : 3);
    });
}

test('unary science transforms a right operand without losing the pending operation', () => {
    const calc = calculator();
    calc.type(10).operator('+').type(3);
    calc.call('doScientific', 'square');
    resultIs(calc, 9);
    historyEndsWith(calc, 9);
    assert.match(calc.expression, /10.*\+/);
    calc.equals();
    resultIs(calc, 19);
    historyEndsWith(calc, 19);
    calc.call('clearAll');
    calc.type(2).operator('pow').type(9);
    calc.call('doScientific', 'sqrt2');
    calc.equals();
    resultIs(calc, 8);
});

for (const [operation, expected] of [['+', 220], ['-', 180], ['*', 20], ['/', 2000]]) {
    test(`percent has the correct context for 200 ${operation} 10%`, () => {
        const calc = calculator();
        calc.type(200).operator(operation).type(10);
        calc.call('percent');
        calc.equals();
        resultIs(calc, expected);
        historyEndsWith(calc, expected);
    });
}

test('standalone percent divides the current number by one hundred', () => {
    const calc = calculator();
    calc.type(50);
    calc.call('percent');
    resultIs(calc, 0.5);
    historyEndsWith(calc, 0.5);
    assert.match(calc.history, /%/);
});

for (const [action, input, expected] of [
    ['square', -3, 9], ['cube', -3, -27], ['sqrt2', 81, 9], ['sqrt3', -27, -3],
    ['pow10', 3, 1000], ['exp', 0, 1], ['ln', 1, 0], ['log10', 1000, 3],
]) {
    test(`${action} calculates and stores a complete result in history`, () => {
        const calc = calculator();
        calc.type(input);
        calc.call('doScientific', action);
        resultIs(calc, expected);
        historyEndsWith(calc, expected);
    });
}

test('natural log and exponential retain useful nontrivial precision', () => {
    const calc = calculator();
    calc.type(2);
    calc.call('doScientific', 'exp');
    assert.ok(Math.abs(Number(calc.current) - Math.exp(2)) < 1e-11);
    calc.call('doScientific', 'ln');
    resultIs(calc, 2);
});

test('general roots support odd negative radicands and negative degrees', () => {
    const calc = calculator();
    calc.type(-27).operator('sqrty').type(3).equals();
    resultIs(calc, -3);
    calc.call('clearAll');
    calc.type(16).operator('sqrty').type(-2).equals();
    resultIs(calc, 0.25);
});

test('C resets current input and errors while retaining the most recent history', () => {
    const calc = calculator();
    const history = seedHistory(calc);
    resultIs(calc, 0);
    assert.equal(calc.history, history);
    calc.type(8).operator('/').type(0).equals();
    assert.ok(calc.error);
    calc.call('clearAll');
    resultIs(calc, 0);
    assert.equal(calc.history, history);
    calc.type(7).equals();
    resultIs(calc, 7);
});

test('history is replaced by the latest completed calculation and survives extra equals', () => {
    const calc = calculator();
    const oldHistory = seedHistory(calc);
    calc.type(9);
    calc.call('doScientific', 'sqrt2');
    const latest = calc.history;
    assert.notEqual(latest, oldHistory);
    historyEndsWith(calc, 3);
    assert.doesNotMatch(latest, /\n/);
    calc.equals().equals();
    assert.equal(calc.history, latest);
    resultIs(calc, 3);
});

test('typing after a result or unary transformation starts a fresh operand', () => {
    const calc = calculator();
    calc.type(2).operator('+').type(3).equals().type(7);
    resultIs(calc, 7);
    calc.call('doScientific', 'square');
    calc.type(4);
    resultIs(calc, 4);
    calc.call('doScientific', 'square');
    calc.call('inputDecimal');
    calc.type(5);
    resultIs(calc, 0.5);
});

test('negative zero allows entering negative integers and decimals', () => {
    const calc = calculator();
    calc.call('negate');
    calc.type(5);
    resultIs(calc, -5);
    calc.call('clearAll');
    calc.call('negate');
    calc.call('inputDecimal');
    calc.type(5);
    resultIs(calc, -0.5);
    calc.call('clearAll');
    calc.type(8).operator('+');
    calc.call('negate');
    calc.type(5).equals();
    resultIs(calc, 3);
});

test('decimal entry is fresh after an operator and rejects a second decimal point', () => {
    const calc = calculator();
    calc.type(2).operator('+');
    calc.call('inputDecimal');
    calc.type(5);
    calc.call('inputDecimal');
    calc.type(2);
    resultIs(calc, 0.52);
    calc.equals();
    resultIs(calc, 2.52);
});

test('DEL edits entered digits and cancels an operator before its right operand', () => {
    const calc = calculator();
    calc.type(123);
    calc.call('deleteLast');
    resultIs(calc, 12);
    calc.operator('+');
    calc.call('deleteLast');
    resultIs(calc, 12);
    calc.equals();
    resultIs(calc, 12);
    assert.equal(calc.history, '');
    calc.operator('pow');
    calc.call('deleteLast');
    calc.equals();
    resultIs(calc, 12);
});

test('DEL after a result or error clears the main display and retains history', () => {
    const calc = calculator();
    calc.type(2).operator('+').type(3).equals();
    const history = calc.history;
    calc.call('deleteLast');
    resultIs(calc, 0);
    assert.equal(calc.history, history);
    calc.type(8).operator('/').type(0).equals();
    assert.ok(calc.error);
    calc.call('deleteLast');
    resultIs(calc, 0);
    assert.equal(calc.history, history);
    calc.type(7).equals();
    resultIs(calc, 7);
});

test('entered fifteen-digit integers survive calculation without rounding', () => {
    const calc = calculator();
    calc.type('123456789012345');
    resultIs(calc, '123456789012345');
    calc.type(6);
    resultIs(calc, '123456789012345');
    calc.operator('+').type(0).equals();
    resultIs(calc, '123456789012345');
    historyEndsWith(calc, '123456789012345');
});

test('display formatting does not round the numeric value used for subsequent operations', () => {
    const calc = calculator();
    calc.type(1).operator('/').type(3).equals().operator('*').type(3).equals();
    resultIs(calc, 1);
    calc.call('clearAll');
    calc.type(0.1).operator('+').type(0.2).equals();
    resultIs(calc, 0.3);
});

test('an ignored duplicate decimal preserves full precision after cancelling a pending operator', () => {
    const calc = calculator();
    calc.type(1).operator('/').type(3).equals().operator('+');
    calc.call('deleteLast');
    calc.call('inputDecimal');
    calc.operator('*').type(3).equals();
    resultIs(calc, 1);
});

const invalidCases = [
    ['division by zero', calc => calc.type(4).operator('/').type(0).equals()],
    ['natural log of zero', calc => { calc.type(0); calc.call('doScientific', 'ln'); }],
    ['log of a negative number', calc => { calc.type(-1); calc.call('doScientific', 'log10'); }],
    ['square root of a negative number', calc => { calc.type(-9); calc.call('doScientific', 'sqrt2'); }],
    ['even root of a negative number', calc => calc.type(-16).operator('sqrty').type(2).equals()],
    ['root with degree zero', calc => calc.type(9).operator('sqrty').type(0).equals()],
    ['zero to the zero power', calc => calc.type(0).operator('pow').type(0).equals()],
    ['zero to a negative power', calc => calc.type(0).operator('pow').type(-1).equals()],
    ['fractional power of a negative base', calc => calc.type(-2).operator('pow').type(0.5).equals()],
    ['exponential overflow', calc => { calc.type(1000); calc.call('doScientific', 'exp'); }],
    ['power-of-ten overflow', calc => { calc.type(309); calc.call('doScientific', 'pow10'); }],
    ['binary power overflow', calc => calc.type(10).operator('pow').type(309).equals()],
];

for (const [name, perform] of invalidCases) {
    test(`${name} reports an error, preserves history, and allows digit recovery`, () => {
        const calc = calculator();
        const history = seedHistory(calc);
        perform(calc);
        assert.equal(typeof calc.error, 'string');
        assert.ok(calc.error.length > 0);
        assert.equal(calc.history, history);
        assert.equal(calc.displayedHistory, history);
        calc.type(7);
        resultIs(calc, 7);
        calc.operator('+').type(1).equals();
        resultIs(calc, 8);
    });
}

test('an error while chaining does not install the requested next operator', () => {
    const calc = calculator();
    const history = seedHistory(calc);
    calc.type(4).operator('/').type(0).operator('+');
    assert.ok(calc.error);
    assert.equal(calc.history, history);
    calc.type(3).equals();
    resultIs(calc, 3);
    assert.equal(calc.history, history);
});

test('public calculation entry points safely resolve pending scientific operations', () => {
    const calc = calculator();
    calc.call('resolveScientificBinary');
    resultIs(calc, 0);
    calc.type(2).operator('pow').type(3);
    calc.call('resolveScientificBinary');
    resultIs(calc, 8);
    calc.operator('+').type(2);
    calc.call('calculate');
    resultIs(calc, 10);
});

test('a tiny nonzero root degree still gives one for a radicand of one', () => {
    const calc = calculator();
    calc.type(1).operator('sqrty').type(-323);
    calc.call('doScientific', 'pow10');
    calc.equals();
    resultIs(calc, 1);
    historyEndsWith(calc, 1);
});

test('Enter on a focused button prevents a native click, while ctrl/meta shortcuts are ignored', () => {
    const calc = calculator();
    calc.type(2).operator('+').type(3);
    const enter = calc.key('Enter');
    assert.equal(enter.defaultPrevented, true, 'Enter must not also click the focused button');
    resultIs(calc, 5);
    const history = calc.history;
    for (const modifier of ['ctrlKey', 'metaKey']) {
        for (const key of ['7', '+', 'Backspace', 'Enter']) {
            const event = calc.key(key, { [modifier]: true });
            assert.equal(event.defaultPrevented, false, 'system shortcut remains available');
            resultIs(calc, 5);
            assert.equal(calc.history, history);
        }
    }
});
