import { describe, expect, it } from 'vitest';
import { bindings } from '../src/source/bindings.js';
import { langForFence, langForPath } from '../src/source/lang.js';
import { lex } from '../src/source/lex.js';
import { packageFromSpecifier } from '../src/source/specifier.js';
import { type TouchInput, touches as touchesFull, walkChain } from '../src/source/touches.js';

const touches = (input: TouchInput): Array<{ package: string; symbols: string[] }> =>
  touchesFull(input).map((t) => ({ package: t.package, symbols: t.symbols }));

const b = (text: string, lang: 'js' | 'py' = 'js'): string[] =>
  bindings(text, lang).map((x) => `${x.local}=${x.package}:${x.imported}`);

describe('packageFromSpecifier', () => {
  it.each([
    ['zod', 'zod'],
    ['drizzle-orm/node-postgres', 'drizzle-orm'],
    ['@tanstack/react-query', '@tanstack/react-query'],
    ['@tanstack/react-query/build/modern', '@tanstack/react-query'],
    ['lodash/debounce', 'lodash'],
    ['date-fns?x=1', 'date-fns'],
    ['./local', undefined],
    ['../x', undefined],
    ['/abs', undefined],
    ['#internal', undefined],
    ['@/components/Button', undefined],
    ['~/utils', undefined],
    ['node:fs', undefined],
    ['fs', undefined],
    ['fs/promises', undefined],
    ['https://esm.sh/zod', undefined],
    ['@scope', undefined],
  ])('%s → %s', (spec, pkg) => {
    expect(packageFromSpecifier(spec)).toBe(pkg);
  });
});

describe('lex', () => {
  it('blanks comments and string contents but keeps offsets and newlines', () => {
    const src = "const a = 'x // y'; // c\n/* import x from 'y' */ b";
    const { code, strings } = lex(src, 'js');
    expect(code.length).toBe(src.length);
    expect(code).toBe("const a = '      ';     \n                        b");
    expect(strings.map((s) => s.value)).toEqual(['x // y']);
  });

  it('handles template literals with nested expressions', () => {
    const { code } = lex('const s = `a ${fn(`b ${c}`)} d`; e', 'js');
    expect(code).toContain('fn(');
    expect(code).toContain(' e');
    expect(code).not.toContain(' d');
  });

  it('treats a slash after an operator as a regex, after an identifier as division', () => {
    const { code } = lex("const r = /'/g; const q = a / b / c; const s = 'z';", 'js');
    expect(code).toContain('a / b / c');
    expect(code).toContain("'z'".replace('z', ' '));
  });

  it('unterminated strings stop at the newline (half-written code)', () => {
    const { code } = lex("const x = 'oops\nimport { a } from 'b'", 'js');
    expect(code).toContain('import { a } from');
  });

  it('python triple-quoted strings and comments', () => {
    const { code, strings } = lex('"""import os"""\n# from x import y\nimport requests', 'py');
    expect(code).not.toContain('import os');
    expect(code).not.toContain('from x');
    expect(code).toContain('import requests');
    expect(strings[0]?.value).toBe('import os');
  });
});

describe('JS/TS bindings', () => {
  it('every static import form', () => {
    expect(
      b(`
      import React, { useEffect as ue, type FC, useState } from 'react';
      import * as z from 'zod';
      import type { Foo } from 'types-only';
      import dayjs from "dayjs";
      import { drizzle } from 'drizzle-orm/node-postgres';
      import { default as axios } from 'axios';
      import './side-effect.css';
      import local from './local';
      import fs from 'node:fs';
    `),
    ).toEqual([
      'React=react:default',
      'ue=react:useEffect',
      'useState=react:useState',
      'z=zod:*',
      'dayjs=dayjs:default',
      'drizzle=drizzle-orm:drizzle',
      'axios=axios:default',
    ]);
  });

  it('multi-line named imports', () => {
    expect(b("import {\n  useQuery,\n  useMutation as um,\n} from '@tanstack/react-query'")).toEqual([
      'useQuery=@tanstack/react-query:useQuery',
      'um=@tanstack/react-query:useMutation',
    ]);
  });

  it('require, destructured require, member require, dynamic import, TS import-equals', () => {
    expect(
      b(`
      const express = require('express');
      const { Router, json: parseJson } = require("express");
      const get = require('lodash').get;
      const { format } = await import('date-fns');
      const mod = await import('zod');
      import yaml = require('js-yaml');
      require('dotenv').config();
    `),
    ).toEqual([
      'yaml=js-yaml:*',
      'express=express:*',
      'Router=express:Router',
      'parseJson=express:json',
      'get=lodash:get',
      'format=date-fns:format',
      'mod=zod:*',
    ]);
  });

  it('imports inside comments and strings are ignored', () => {
    expect(b("// import x from 'a'\nconst s = \"import y from 'b'\";\n/* require('c') */")).toEqual([]);
  });

  it('a syntax error before the imports does not lose them', () => {
    expect(b("const broken = {{{ (\nimport { z } from 'zod'\nfunction (")).toEqual(['z=zod:z']);
  });

  it('member access named import is not an import', () => {
    expect(b("obj.import { x } from 'y'")).toEqual([]);
  });
});

describe('Python bindings', () => {
  it('import forms', () => {
    expect(
      b(
        `import requests
import numpy as np, os
import matplotlib.pyplot as plt
import google.protobuf
from pydantic import BaseModel, Field as F
from sqlalchemy.orm import (
    Session,
    declarative_base as base,
)
from . import sibling
from .mod import thing
from x import *
import a.b.c as \\
    abc`,
        'py',
      ),
    ).toEqual([
      'requests=requests:*',
      'np=numpy:*',
      'os=os:*',
      'plt=matplotlib:*',
      'google=google:*',
      'BaseModel=pydantic:BaseModel',
      'F=pydantic:Field',
      'Session=sqlalchemy:Session',
      'base=sqlalchemy:declarative_base',
      'abc=a:*',
    ]);
  });

  it('imports in docstrings are ignored', () => {
    expect(b('"""\nfrom fake import thing\n"""\nimport real', 'py')).toEqual(['real=real:*']);
  });
});

describe('walkChain', () => {
  const chain = (code: string, lang: 'js' | 'py' = 'js'): string[] => walkChain(code, 0, lang);
  it.each([
    ['.string().email()', ['string', 'email']],
    ['.$client.end()', ['$client', 'end']],
    ['?.data?.items[0].name', ['data', 'items', 'name']],
    ['\n  .string()\n  .min(1)\n  .email()', ['string', 'min', 'email']],
    ['<User>(id).then(x => x)', ['then']],
    ['!.foo', ['foo']],
    ['.a.b.c.d.e.f.g.h', ['a', 'b', 'c', 'd', 'e', 'f']],
    [' + 1', []],
    [' < b', []],
  ])('%j → %j', (code, expected) => {
    expect(chain(code)).toEqual(expected);
  });

  it('python', () => {
    expect(chain('.Session().mount("x", adapter).close()', 'py')).toEqual(['Session', 'mount', 'close']);
  });
});

describe('touches', () => {
  it('named import used through a chain', () => {
    const file = "import { z } from 'zod';\nconst s = z.object({ email: z.string().email() });";
    expect(touches({ fileText: file, changedText: 'email: z.string().email()', lang: 'js' })).toEqual([
      { package: 'zod', symbols: ['z', 'string', 'email'] },
    ]);
  });

  it('derived alias carries the package but not its own name', () => {
    const file = "import { drizzle } from 'drizzle-orm/node-postgres';\nconst db = drizzle({ connection });\nafterAll(() => db.$client.end());";
    expect(touches({ fileText: file, changedText: 'afterAll(() => db.$client.end());', lang: 'js' })).toEqual([
      { package: 'drizzle-orm', symbols: ['$client', 'end'] },
    ]);
  });

  it('only the changed text counts', () => {
    const file = "import axios from 'axios';\naxios.get('/a');\nconsole.log(1);";
    expect(touches({ fileText: file, changedText: 'console.log(1);', lang: 'js' })).toEqual([]);
  });

  it('default import touches its local name and members', () => {
    const file = "import axios from 'axios';\nawait axios.post(url, body);";
    expect(touches({ fileText: file, changedText: 'await axios.post(url, body);', lang: 'js' })).toEqual([
      { package: 'axios', symbols: ['axios', 'post'] },
    ]);
  });

  it('JSX component usage', () => {
    const file = "import { Dialog } from '@radix-ui/react-dialog';\nexport const X = () => <Dialog.Root open />;";
    expect(touches({ fileText: file, changedText: '<Dialog.Root open />', lang: 'js' })).toEqual([
      { package: '@radix-ui/react-dialog', symbols: ['Dialog', 'Root'] },
    ]);
  });

  it('identifiers inside strings and comments in the changed text do not count', () => {
    const file = "import { z } from 'zod';\n";
    expect(touches({ fileText: file, changedText: "// z.string()\nconst s = 'z.email()';", lang: 'js' })).toEqual([]);
  });

  it('object keys with the same name as a binding are not uses', () => {
    const file = "import { drizzle } from 'drizzle-orm';\n";
    expect(touches({ fileText: file, changedText: 'const cfg = { drizzle: true };', lang: 'js' })).toEqual([]);
  });

  it('python: module attribute chain and derived alias', () => {
    const file = 'import requests\ns = requests.Session()\nr = s.get(url, timeout=5)\n';
    expect(touches({ fileText: file, changedText: 'r = s.get(url, timeout=5)', lang: 'py' })).toEqual([
      { package: 'requests', symbols: ['get'] },
    ]);
    expect(touches({ fileText: file, changedText: 's = requests.Session()', lang: 'py' })).toEqual([
      { package: 'requests', symbols: ['requests', 'Session'] },
    ]);
  });

  it('python: from-import name', () => {
    const file = 'from pydantic import RootModel\nclass Tags(RootModel[list[str]]):\n    pass\n';
    expect(touches({ fileText: file, changedText: 'class Tags(RootModel[list[str]]):', lang: 'py' })).toEqual([
      { package: 'pydantic', symbols: ['RootModel'] },
    ]);
  });
});

describe('touches: pairs and deep specifiers', () => {
  it('records adjacent chain pairs and subpath imports', () => {
    const file = "import dynamic from 'next/dynamic';\nconst C = dynamic(() => import('./c'));";
    expect(touchesFull({ fileText: file, changedText: "dynamic(() => import('./c'))", lang: 'js' })).toEqual([
      { package: 'next', symbols: ['dynamic'], pairs: [], specifiers: ['next/dynamic'] },
    ]);
    const z = "import { z } from 'zod';\nz.string().email();";
    expect(touchesFull({ fileText: z, changedText: 'z.string().email();', lang: 'js' })[0]?.pairs).toEqual(['z.string', 'string.email']);
  });
});

describe('lang', () => {
  it('maps extensions and fence tags', () => {
    expect(langForPath('/a/b.tsx')).toBe('js');
    expect(langForPath('x.py')).toBe('py');
    expect(langForPath('README.md')).toBeUndefined();
    expect(langForFence('typescript title="x"')).toBe('js');
    expect(langForFence('python')).toBe('py');
    expect(langForFence('bash')).toBeUndefined();
  });
});
