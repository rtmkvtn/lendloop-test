/// <reference types="vite/client" />
// Array form: the docs' extglob pattern matches nothing under vite 8.
export const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
