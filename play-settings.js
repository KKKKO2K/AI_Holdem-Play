/* Small, offline-only visual/playback preferences. Never changes AI policy. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HoldemPlaySettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'felt-fable-play-settings-v1';
  const DEFAULT = Object.freeze({pace:'normal',reactions:'full',showdown:true});
  const FACTOR = Object.freeze({quick:.58,normal:1,relaxed:1.35});
  function normalize(input) {
    const x = input && typeof input === 'object' ? input : {};
    return Object.freeze({
      pace: Object.hasOwn(x,'pace') && Object.hasOwn(FACTOR,x.pace) ? x.pace : DEFAULT.pace,
      reactions: Object.hasOwn(x,'reactions') && ['full','quiet','off'].includes(x.reactions) ? x.reactions : DEFAULT.reactions,
      showdown: Object.hasOwn(x,'showdown') && typeof x.showdown === 'boolean' ? x.showdown : DEFAULT.showdown
    });
  }
  function load(storage) {
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      const raw = store && store.getItem(KEY);
      return normalize(raw ? JSON.parse(raw) : null);
    } catch (_error) { return normalize(null); }
  }
  function save(value, storage) {
    const pref = normalize(value);
    try {
      const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (store) store.setItem(KEY,JSON.stringify(pref));
    } catch (_error) { /* file:// privacy mode may deny local storage */ }
    return pref;
  }
  function milliseconds(ms, value) {
    const cfg=normalize(value);
    const n=Number.isFinite(ms) && ms>=0 ? ms : 0;
    return Math.max(65,Math.round(n*FACTOR[cfg.pace]));
  }
  return Object.freeze({KEY,DEFAULT,FACTOR,normalize,load,save,milliseconds});
});
