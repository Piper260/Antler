/**
 * Large classes keep groups of methods in separate files, each written as a
 * plain class. This copies those methods onto the real class's prototype,
 * so they behave as if written in its body. A name defined twice is a
 * mistake, so it throws rather than letting one silently replace the other.
 * Methods moved this way must not use `super`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mixMethods = api.mixMethods;
})(typeof self !== 'undefined' ? self : this, function () {
  function mixMethods(target, ...parts) {
    for (const part of parts) {
      for (const name of Object.getOwnPropertyNames(part.prototype)) {
        if (name === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(target.prototype, name)) {
          throw new Error(`${target.name}.${name} is defined twice (again in ${part.name})`);
        }
        Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(part.prototype, name));
      }
    }
    return target;
  }
  return { mixMethods };
});
