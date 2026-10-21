# Trap-task feasibility spike (2026-10-21)

Repros ran in Docker only (`--network none`, 2 GB, 2 CPUs) after installing the exact pin.
Directories: one per repro, each with script + output.log / output.run2.log / output.latest.log.

## Funnel
- Index entries / unique issues: 630 / 606
- Pure-library packages: 295 · visual/type-level (plotly, seaborn, matplotlib, typescript): 92 · environment-bound: 219 (~36%)
- Shortlisted after reading threads: 54 (all OPEN on 2026-10-21)
- Repro scripts written: 42 · reproduced deterministically at the pin: 41/42 · workaround verified: 38/41
- Solid: Tier A 23, Tier B 12 (35 total). Not usable: 7.
- 32 of 35 still reproduce on today's latest; pydantic#10570 and numpy#27580 fixed upstream; knex#6074 now throws (3.3.0).
- 14/35 have the workaround quoted in the thread; the rest are an obvious local fix.

## Tier A (23)
| issue | pkg@ver | bug | observed | workaround | task idea | hidden test |
|---|---|---|---|---|---|---|
| dayjs#2797 (+2778,2741) | dayjs@1.11.13 | strict parse with Z/ZZ offset always invalid | "20241224 061500 +0600" INVALID | regex-check + lenient parse | parse bank-export timestamps, null if malformed | valid→ISO; malformed→null |
| dayjs#2750 (+2815,2479) | dayjs@1.11.13 | add(duration({weeks})) adds nothing | {weeks:2} → 2024-01-01 | add per unit | nextRenewal(start,{weeks:2}) | +14 days |
| dayjs#2901 | dayjs@1.11.13 | dayjs('600','Hmm') → 12:00 PM | 600→12:00 PM | pad to 4 + HHmm | legacy 24h ints → h:mm A | 600→6:00 AM |
| dayjs#2818 (+2779) | dayjs@1.11.13 | DD.MMM.YY / MMM. YYYY won't parse | 29.Jul.21 INVALID | replace . with space | parse manifest dates | → 2021-07-29 |
| dayjs#3013 | dayjs@1.11.13 | dayjs.utc(s,[formats]) parses local | TZ=Europe/Paris → 1995-04-30T22:00Z | per-format dayjs.utc(s,f,true) | birth dates (2 formats) as UTC midnight | TZ=Europe/Paris |
| dayjs#2762 (+2726,2464) | dayjs@1.11.13 | duration(diff) hours wrong >~30d | 58d 23:59:59 → 58d 13h… | integer ms math | countdown string | exact string 58d span |
| dayjs#2938 (+2871) | dayjs@1.11.13 | isValid() true for 'dall-e-3', '2025-02-30' | yes | strict format parse | validate ?since=YYYY-MM-DD → 400 | 2025-02-30 → 400 |
| date-fns#3873 (+3233) | date-fns@3.6.0 | intervalToDuration negative parts | {months:1,hours:-3} | differenceInHours-based | "N months N days N hours left" | no negatives |
| node-jsonwebtoken#1000 | jsonwebtoken@9.0.2 | sign callback fires twice on iss conflict | 2 responses | sync sign in try/catch | callback POST /tokens with issuer | exactly one 400 |
| knex#6074 | knex@3.1.0 | .limit() dropped from DELETE | no LIMIT in SQL | whereIn(id, sub.limit(n)) | delete ≤N expired sessions | SQL bounded |
| knex#6163 | knex@3.1.0 | named-binding raw() substitutes into literal ? | `profile 42 'admin' … = ?` | escape \\? | jsonb has-key with :org | exact SQL |
| axios#6587 | axios@1.7.7 | instance auth overrides per-request Authorization | Bearer arrives as Basic | Basic in default headers | default Basic, Bearer for admin | loopback header check |
| pydantic#10570 | pydantic@2.9.2 | use_enum_values ignored with nested list[Model] | dumps <Currency.USD> | model_dump(mode='json') | add preferred_currencies | type is str |
| pydantic#10891 | pydantic@2.9.2 | TypeAdapter(list).dump_json NaN → null | null | RootModel | export keeping NaN/Inf | NaN/Infinity in output |
| pandas#62072 | pandas@2.2.3 | to_json loses float precision | 0.2617993877991494→0.2617993878 | json.dumps(to_dict()) | JSON round-trip | equals(original) |
| pandas#11953 | pandas@2.2.3 | fillna('') leaves NaT | NaT stays | astype(object).where(notna,'') | blank missing for report | no NaT |
| pandas#29576 | pandas@2.2.3 | resample('2QS-MAR') anchors Dec/Jun | labels 12-01/06-01 | explicit half-year key + groupby | half-years from Mar 1/Sep 1 | exact labels/sums |
| numpy#27674 | numpy@2.1.2 | np.ptp(masked) → nan | nan | np.ma.ptp | sensor range ignoring NaN | == 5.0 |
| numpy#27540 | numpy@2.1.2 | uint32 \|= IntEnum raises | UFuncTypeError | int(member) | DQ flags from IntEnum | flags correct |
| pyyaml#868 (+861) | pyyaml@6.0.2 | safe_load('x: 0b_') bare ValueError | escapes except YAMLError | also catch ValueError | load_config → ConfigError | 0b_ → ConfigError |
| sklearn#30935 | scikit-learn@1.5.2 | default tokenizer shreds Hindi/Telugu | ['आध','नक',…] | token_pattern=r"(?u)\S+" | BoW for Hindi/Telugu titles | whole words |
| sklearn#30332 | scikit-learn@1.5.2 | NuSVC(class_weight) no effect | identical | sample_weight | up-weight rare class | weighted recall > unweighted |
| requests#6917 | requests@2.32.3 | data=StringIO(non-ASCII) short Content-Length | 36/40 bytes | .getvalue().encode() | POST in-memory CSV | exact bytes |

## Tier B (12)
knex#5775 (.comment() dropped on pg writes), pydantic#10694 (Parent|Child union dumps {}), pydantic#10629 (tuple-valued Enum JSON round-trip),
pandas#61568 (fillna(df) dtype change for all-NaN cols), pandas#61223 (df.at[r,'new']=[list] raises), numpy#27679 (masked uint8 += 5),
numpy#27580 (masked uint .min(axis=0) raises), networkx#7758 (MultiGraph monomorphism), sklearn#31350 (imputer category→object),
plotly#4957 (validate_colors rejects named/hsl), seaborn#3825 (pointplot dodge one hue level), seaborn#3641 (scatterplot s=array + hue).

## Not usable (7)
dayjs#2768 (no repro), dayjs#2763 (host-TZ only), jwt#945 (needs valueOf keys), knex#6134 ($ in binding), cheerio#4068 (unusual path),
click#2753 (no workaround), polars#19418 (Object dtype segfault).

## Unusable bug classes
Environment-bound (~36%), type-level/tooling-only, visual/rendering, perf regressions, not-a-bug/by-design, fuzzer-style triggers,
wrong version attribution (scipy#22368 is a 1.15 regression indexed against 1.14.1; several plotly 6 / pandas 3 / Node 24 hits).

## Design notes
Forbid dependency bumps; set non-UTC TZ for dayjs#3013; seed code must contain the triggering shape for narrow triggers;
grade offline (compiled SQL, loopback servers); record whether the agent called the buggy API separately from pass/fail.
