const { mixMethods } = require('../src/renderer/js/utils/mixMethods');

describe('mixMethods', () => {
  test('methods from a part behave as if written in the class', () => {
    class Tool {
      constructor() { this.name = 'tool'; }
      greet() { return `hi from ${this.label()}`; }
    }
    class Labels {
      label() { return this.name; }
      async loadLabel() { return this.label(); }
      get upper() { return this.name.toUpperCase(); }
    }
    mixMethods(Tool, Labels);
    const tool = new Tool();
    expect(tool.greet()).toBe('hi from tool');
    expect(tool.upper).toBe('TOOL');
    return expect(tool.loadLabel()).resolves.toBe('tool');
  });

  test('copied methods are not enumerable, like class methods', () => {
    class Tool {}
    class Part { extra() {} }
    mixMethods(Tool, Part);
    expect(Object.keys(Tool.prototype)).toEqual([]);
  });

  test('a method defined twice throws', () => {
    class Tool { save() {} }
    class Part { save() {} }
    expect(() => mixMethods(Tool, Part)).toThrow('Tool.save is defined twice (again in Part)');
  });
});
