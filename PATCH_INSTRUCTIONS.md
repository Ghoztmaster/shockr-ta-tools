# Fase 1 afrondingspatches

## 1. $Poll false-positive fix (lib/clientlib-patch.js)

In `applyPatch()`, verander het blok:

```javascript
            if (obfName) {
                defineGetter(proto, prop.publicName, obfName);
                result.matched[prop.publicName] = obfName;
            } else {
                result.ok = false;
                result.failed.push(prop.publicName);
            }
```

Naar:

```javascript
            if (prop.resolver) {
                // Custom resolvers handle their own patching
                // Return true = success, false/null = failure
                try {
                    const resolved = prop.resolver(proto);
                    if (resolved !== false) {
                        result.matched[prop.publicName] = resolved || '(custom)';
                    } else {
                        result.ok = false;
                        result.failed.push(prop.publicName);
                    }
                } catch {
                    result.ok = false;
                    result.failed.push(prop.publicName);
                }
            } else if (obfName) {
                defineGetter(proto, prop.publicName, obfName);
                result.matched[prop.publicName] = obfName;
            } else {
                result.ok = false;
                result.failed.push(prop.publicName);
            }
```

En verander de $Poll resolver om `true` te returnen bij success:

```javascript
            {
                publicName: '$Poll',
                resolver(proto) {
                    const fn = findFunctionByContent(proto, '"Poll"');
                    if (!fn) return false;
                    if (typeof proto['$Poll'] === 'undefined') {
                        proto['$Poll'] = proto[fn.name];
                    }
                    return fn.name;  // was: return null
                },
            },
```

## 2. BugFixer (lib/bugfix.js)

Nieuw bestand, zie bijgevoegd `lib/bugfix.js`.

## 3. main.js — importeer bugfix

Voeg toe bovenaan bij de imports:

```javascript
import { fixUnload } from './bugfix.js';
```

Voeg toe na `idle.start();` (regel ~75):

```javascript
    fixUnload();
```

## 4. README.md — vervang door bijgevoegd bestand
