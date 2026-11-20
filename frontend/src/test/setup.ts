// Setup dos testes (jsdom): stubs de APIs de browser que o jsdom não implementa.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverStub;
(globalThis as any).matchMedia = (globalThis as any).matchMedia || (() => ({
  matches: false, addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}));
