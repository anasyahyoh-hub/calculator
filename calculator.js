/** Scientific calculator. Binary operations execute from left to right. */
'use strict';

const MAX_DIGITS = 15;
const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷', pow: '^' };
const binaryOperators = new Set(['+', '-', '*', '/', 'pow', 'sqrty']);
const state = {
    current: '0',
    value: 0, // Keep the full numeric result independently of its displayed rounding.
    stored: null,
    operator: null,
    mode: 'input', // input, awaiting, result, transformed, or error
    expression: '',
    history: '',
    error: null,
};

function formatNumber(number) {
    if (!Number.isFinite(number)) throw new Error('ผลลัพธ์เกินขอบเขตที่คำนวณได้');
    if (Object.is(number, -0)) return '0';
    if (Number.isInteger(number) && Math.abs(number) < 1e16) return String(number);
    return String(Number(number.toPrecision(MAX_DIGITS)));
}

function operandLabel(number) {
    const label = formatNumber(number);
    return number < 0 ? `(${label})` : label;
}

function currentValue() {
    const value = state.value === null ? Number(state.current) : state.value;
    if (!Number.isFinite(value)) throw new Error('จำนวนที่ป้อนไม่ถูกต้อง');
    return value;
}

function pendingExpression() {
    if (!state.operator) return '';
    const right = state.mode === 'awaiting' ? '' : state.current;
    if (state.operator === 'sqrty') return `${right || 'n'}√(${formatNumber(state.stored)})`;
    const signedRight = right.startsWith('-') ? `(${right})` : right;
    return `${operandLabel(state.stored)} ${symbols[state.operator]} ${signedRight}`.trim();
}

function updateDisplays() {
    state.expression = state.error || pendingExpression();
    const display = document.getElementById('Display');
    const preDisplay = document.getElementById('preDisplay');
    const hisDisplay = document.getElementById('hisDisplay');
    if (display) {
        display.value = state.current;
        display.classList.toggle('error', state.error !== null);
        display.setAttribute('aria-invalid', String(state.error !== null));
        const length = state.current.replace(/[-.]/g, '').length;
        display.style.fontSize = length > 12 ? 'clamp(16px, 4vw, 24px)'
            : length > 9 ? 'clamp(20px, 5vw, 32px)' : '';
        display.scrollLeft = display.scrollWidth;
    }
    if (preDisplay) {
        preDisplay.value = state.expression;
        preDisplay.title = state.expression;
        preDisplay.scrollLeft = preDisplay.scrollWidth;
    }
    if (hisDisplay) {
        hisDisplay.value = state.history;
        hisDisplay.title = state.history;
        hisDisplay.scrollLeft = hisDisplay.scrollWidth;
    }
    highlightOperator(state.operator);
}

function highlightOperator(operator) {
    document.querySelectorAll('.calculator button').forEach(button => {
        const isBinary = button.dataset.action === 'operator'
            || button.dataset.action === 'pow' || button.dataset.action === 'sqrty';
        const value = button.dataset.action === 'operator' ? button.dataset.value : button.dataset.action;
        const active = isBinary && operator !== null && value === operator;
        button.classList.toggle('active-op', active);
        if (isBinary) button.setAttribute('aria-pressed', String(active));
    });
}

function clearOperatorHighlight() {
    highlightOperator(null);
}

function resetState() {
    // C, DEL and error recovery must not erase the previous calculation.
    Object.assign(state, {
        current: '0', value: 0, stored: null, operator: null,
        mode: 'input', expression: '', error: null,
    });
    updateDisplays();
}

function clearAll() {
    resetState();
}

function prepareEntry() {
    if (state.error) resetState();
    if (state.mode !== 'input') {
        state.current = '0';
        state.value = null;
        state.mode = 'input';
    }
    // A restored scientific-notation answer is replaced instead of edited as text.
    if (/e/i.test(state.current)) state.current = '0';
}

function inputDigit(digit) {
    if (typeof digit !== 'string' || !/^[0-9]$/.test(digit)) return;
    prepareEntry();
    if (state.current.replace(/[-.]/g, '').length >= MAX_DIGITS) return;
    if (state.current === '0') state.current = digit;
    else if (state.current === '-0') state.current = '-' + digit;
    else state.current += digit;
    state.value = null;
    updateDisplays();
}

function inputDecimal() {
    prepareEntry();
    if (state.current.includes('.')) return;
    state.current += '.';
    state.value = null;
    updateDisplays();
}

function negate() {
    if (state.error) resetState();
    if (state.mode === 'awaiting') {
        state.current = '-0';
        state.value = null;
        state.mode = 'input';
    } else {
        const value = currentValue();
        state.current = state.current.startsWith('-') ? state.current.slice(1) : '-' + state.current;
        state.value = state.value === null ? null : -value;
    }
    updateDisplays();
}

function deleteLast() {
    if (state.error || state.mode === 'result') {
        resetState();
        return;
    }
    if (state.mode === 'awaiting') {
        state.current = formatNumber(state.stored);
        state.value = state.stored;
        state.stored = null;
        state.operator = null;
    } else {
        state.current = state.mode === 'transformed' || /e/i.test(state.current)
            ? '0' : state.current.slice(0, -1);
        if (state.current === '' || state.current === '-') state.current = '0';
        state.value = null;
    }
    state.mode = 'input';
    updateDisplays();
}

function setError(message = 'ไม่สามารถคำนวณได้') {
    Object.assign(state, {
        current: 'Error', value: null, stored: null, operator: null,
        mode: 'error', error: message,
    });
    updateDisplays();
}

function realPower(base, exponent) {
    if (base === 0 && exponent === 0) throw new Error('0 ยกกำลัง 0 ไม่กำหนดค่า');
    if (base === 0 && exponent < 0) throw new Error('ไม่สามารถหารด้วยศูนย์ได้');
    if (base < 0 && !Number.isInteger(exponent)) throw new Error('ผลลัพธ์ไม่อยู่ในจำนวนจริง');
    return Math.pow(base, exponent);
}

function realRoot(value, degree) {
    if (degree === 0) throw new Error('อันดับรากต้องไม่เป็นศูนย์');
    if (value === 1) return 1;
    if (value === 0 && degree < 0) throw new Error('ไม่สามารถหารด้วยศูนย์ได้');
    if (value < 0) {
        if (!Number.isInteger(degree) || Math.abs(degree % 2) !== 1) {
            throw new Error('รากของจำนวนลบต้องเป็นอันดับคี่');
        }
        return -Math.pow(-value, 1 / degree);
    }
    return Math.pow(value, 1 / degree);
}

function binaryResult(operator, a, b) {
    switch (operator) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
            if (b === 0) throw new Error('ไม่สามารถหารด้วยศูนย์ได้');
            return a / b;
        case 'pow': return realPower(a, b);
        case 'sqrty': return realRoot(a, b);
        default: throw new Error('เครื่องหมายไม่ถูกต้อง');
    }
}

function setOperator(operator) {
    if (!binaryOperators.has(operator) || state.error) return;
    // Changing an operator before entering the next number only replaces it.
    if (state.operator && state.mode === 'awaiting') {
        state.operator = operator;
        updateDisplays();
        return;
    }
    if (state.operator && !calculate()) return;
    state.stored = currentValue();
    state.operator = operator;
    state.mode = 'awaiting';
    updateDisplays();
}

function calculate(addToHistory = true) {
    if (state.error || !state.operator || state.stored === null || state.mode === 'awaiting') return false;
    try {
        const a = state.stored;
        const b = currentValue();
        const value = binaryResult(state.operator, a, b);
        const formatted = formatNumber(value); // Validate before changing history or state.
        const expression = state.operator === 'sqrty'
            ? `${operandLabel(b)}√(${formatNumber(a)})`
            : `${operandLabel(a)} ${symbols[state.operator]} ${operandLabel(b)}`;
        if (addToHistory) state.history = `${expression} = ${formatted}`;
        Object.assign(state, {
            current: formatted, value, stored: null, operator: null,
            mode: 'result', error: null,
        });
        updateDisplays();
        return true;
    } catch (error) {
        setError(error.message);
        return false;
    }
}

function finishUnary(value, label) {
    const formatted = formatNumber(value);
    state.history = `${label} = ${formatted}`;
    state.current = formatted;
    state.value = value;
    state.mode = state.operator ? 'transformed' : 'result';
    updateDisplays();
}

function percent() {
    if (state.error || state.mode === 'awaiting') return;
    try {
        const value = currentValue();
        const relative = state.operator === '+' || state.operator === '-';
        // + and − use a percentage of the left operand; × and ÷ use a fraction.
        const result = relative ? state.stored * (value / 100) : value / 100;
        const label = relative
            ? `${operandLabel(state.stored)} × (${formatNumber(value)} / 100)`
            : `${operandLabel(value)}%`;
        finishUnary(result, label);
    } catch (error) {
        setError(error.message);
    }
}

function doScientific(action) {
    if (state.error) return;
    if (action === 'pow' || action === 'sqrty') {
        setOperator(action);
        return;
    }
    if (state.mode === 'awaiting') return;
    try {
        const value = currentValue();
        const label = formatNumber(value);
        switch (action) {
            case 'square': finishUnary(realPower(value, 2), `(${label})²`); break;
            case 'cube': finishUnary(realPower(value, 3), `(${label})³`); break;
            case 'sqrt2':
                if (value < 0) throw new Error('รากที่สองของจำนวนลบไม่อยู่ในจำนวนจริง');
                finishUnary(Math.sqrt(value), `√(${label})`);
                break;
            case 'sqrt3': finishUnary(Math.cbrt(value), `∛(${label})`); break;
            case 'pow10': finishUnary(Math.pow(10, value), `10^(${label})`); break;
            case 'exp': finishUnary(Math.exp(value), `e^(${label})`); break;
            case 'ln':
                if (value <= 0) throw new Error('ln ใช้ได้กับจำนวนที่มากกว่าศูนย์');
                finishUnary(Math.log(value), `ln(${label})`);
                break;
            case 'log10':
                if (value <= 0) throw new Error('log ใช้ได้กับจำนวนที่มากกว่าศูนย์');
                finishUnary(Math.log10(value), `log₁₀(${label})`);
                break;
        }
    } catch (error) {
        setError(error.message);
    }
}

function resolveScientificBinary() {
    return state.operator === 'pow' || state.operator === 'sqrty' ? calculate() : false;
}

function equalsPressed() {
    return calculate();
}

function initializeCalculator() {
    const calculator = document.querySelector('.calculator');
    if (!calculator) return;
    calculator.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || !calculator.contains(button) || button.disabled) return;
        const { action, value } = button.dataset;
        switch (action) {
            case 'digit': inputDigit(value); break;
            case 'decimal': inputDecimal(); break;
            case 'operator': setOperator(value); break;
            case 'equals': equalsPressed(); break;
            case 'del': deleteLast(); break;
            case 'clear': clearAll(); break;
            case 'percent': percent(); break;
            case 'negate': negate(); break;
            default: if (action) doScientific(action);
        }
    });

    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        const target = event.target;
        if (target?.isContentEditable || target?.tagName === 'SELECT'
            || (['INPUT', 'TEXTAREA'].includes(target?.tagName) && !target.readOnly)) return;
        const key = event.key;
        let action;
        if (/^[0-9]$/.test(key)) action = () => inputDigit(key);
        else if (['+', '-', '*', '/'].includes(key)) action = () => setOperator(key);
        else if (key === '^') action = () => doScientific('pow');
        else if (key === '.' || key === ',') action = inputDecimal;
        else if (key === 'Enter' || key === '=') action = equalsPressed;
        else if (key === 'Backspace') action = deleteLast;
        else if (key === 'Escape' || key === 'Delete') action = clearAll;
        else if (key === '%') action = percent;
        if (!action) return;
        // In particular, Enter must not also click a focused number button.
        event.preventDefault();
        action();
    });
    updateDisplays();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCalculator, { once: true });
} else {
    initializeCalculator();
}
