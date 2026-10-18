import { describe, expect, it } from 'vitest';
import { familyMealsCredentialsForSave } from '../familyMealsCredentials';
import { familyMealsView, widgetOptionKind } from '../widgetOptions';

const token = `fm_${'a'.repeat(40)}`;

describe('Family Meals credentials form', () => {
  it('trims the address and token', () => {
    expect(familyMealsCredentialsForSave({ baseUrl: ' https://meals.example.com ', token: ` ${token} ` })).toEqual({ baseUrl: 'https://meals.example.com', token });
  });
  it.each(['', 'meals.example.com', 'http://meals.example.com', 'https://user:pw@meals.example.com', `https://meals.example.com/${'x'.repeat(2048)}`])('rejects the address %j', (baseUrl) => {
    expect(() => familyMealsCredentialsForSave({ baseUrl, token })).toThrow('url');
  });
  it.each(['', 'ntn_abcdefghijklmnopqrstuvwxyz', 'fm_short', `fm_${'a'.repeat(101)}`, `fm_${'a b'.repeat(10)}`])('rejects the token %j', (bad) => {
    expect(() => familyMealsCredentialsForSave({ baseUrl: 'https://meals.example.com', token: bad })).toThrow('token');
  });
  it('gives the widget a view option', () => {
    expect(widgetOptionKind('family-meals')).toBe('family-meals');
  });
  it.each(['full', 'condensed', 'upcoming', 'planner', 'recipe'])('keeps the %s view', (view) => {
    expect(familyMealsView(view)).toBe(view);
  });
  it.each([undefined, '', 'week', 'list'])('falls back to the week for %j', (view) => {
    expect(familyMealsView(view)).toBe('full');
  });
});
