import { AsyncLocalStorage } from 'node:async_hooks';
const storage = new AsyncLocalStorage<string>();
export function runIncidentContext<T>(channel:string, fn:()=>T):T{return storage.run(channel,fn);}
export function getIncidentContext():string|undefined{return storage.getStore();}
