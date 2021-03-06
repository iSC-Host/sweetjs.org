let quoteSyntax = macro {
    function(stx) {
        var name_stx = stx[0];

        if (!(stx[1] && stx[1].token && stx[1].token.inner)) {
            throwSyntaxError("macro", "Macro `quoteSyntax` could not be matched" , stx[1]);
        }

        var res = [
            makeIdent("#quoteSyntax", null),
            stx[1].expose()
        ];

        return {
            result: res,
            rest: stx.slice(2)
        };
    }
}
export quoteSyntax

let syntax = macro {
    function(stx) {
        var name_stx = stx[0];
        var here = quoteSyntax{here};
        var takeLineContext = patternModule.takeLineContext;
        var takeLine = patternModule.takeLine;
        var mod = makeIdent("patternModule", here);

        if (!(stx[1] && stx[1].token && stx[1].token.inner)) {
            throwSyntaxError("macro", "Macro `syntax` could not be matched", stx[1]);
        }

        var res = [mod,
                   makePunc(".", here),
                   makeIdent("transcribe", here),
                   makeDelim("()", [
                       makeIdent("#quoteSyntax", here),
                       stx[1].expose(),
                       makePunc(",", here),
                       // breaking hygiene to capture `name_stx`, `match`, and
                       // `patternEnv` inside the syntaxCase macro
                       makeIdent("name_stx", name_stx),
                       makePunc(",", here),
                       makeIdent("match", name_stx),
                       makePunc(".", here),
                       makeIdent("patternEnv", name_stx)
                   ], here)];


        return {
            result: res,
            rest: stx.slice(2)
        };
    }
}
export syntax

macro # {
    function (stx) {
        return {
            // breaking hygiene to capture inside syntaxCase
            result: [makeIdent("syntax", stx[0]),
                     stx[1]],
            rest: stx.slice(2)
        }
    }
}
export #


let syntaxCase = macro {
    function(stx, context) {
        var name_stx = stx[0];
        var here = quoteSyntax{here};

        if (!(stx[1] && stx[1].token && stx[1].token.inner) ||
            !(stx[2] && stx[2].token && stx[2].token.inner)) {
            throwSyntaxError("macro", "Macro `syntaxCase` could not be matched" , stx[1]);
        }

        var arg_stx = stx[1].expose().token.inner;
        var cases_stx = stx[2].expose().token.inner;

        var Token = parser.Token;
        var assert = parser.assert;
        var loadPattern = patternModule.loadPattern;
        var takeLine = patternModule.takeLine;
        var matchPatterns = matchPatterns;

        function makeFunc(params, body) {
            return [
                makeKeyword("function", here),
                makeDelim("()", params, here),
                makeDelim("{}", body, here)
            ];
        }

        function makeVarDef(id, expr) {
            return [
                makeKeyword("var", here),
                makeIdent(id, name_stx),
                makePunc("=", here)
            ].concat(expr, makePunc(";", here));
        }

        function makeAssign(id, expr) {
          return [
            makeIdent(id, name_stx),
            makePunc("=", here)
          ].concat(expr, makePunc(";", here));
        }

        function cloneSyntax(stx) {
            var clone = _.extend({}, stx, { token: _.clone(stx.token) });
            if (clone.token.inner) {
                clone.token.inner = clone.token.inner.map(cloneSyntax);
            }
            return clone;
        }

        if (cases_stx.length == 0) {
            throw new Error("Must have at least one case")
        }

        var cases = [];

        for (var i = 0; i < cases_stx.length; i += 4) {
            var caseKwd = cases_stx[i];
            var isInfix = cases_stx[i + 1].token.value === "infix";
            if (isInfix) {
                i += 1;
            }
            var casePattern = cases_stx[i + 1];
            var caseArrow = cases_stx[i + 2];
            var caseBody = cases_stx[i + 3];

            if (!(caseKwd && caseKwd.token && caseKwd.token.value === "case")) {
                throw new Error("expecting case keyword in syntax case");
            }
            if (!(casePattern && casePattern.token && casePattern.token.value === "{}")) {
                throw new Error("expecting a pattern surrounded by {} in syntax case");
            }
            if (!(caseArrow && caseArrow.token && caseArrow.token.value === "=>")) {
                throw new Error("expecting an arrow separating pattern from body in syntax case");
            }
            if (!(caseBody && caseBody.token && caseBody.token.value === "{}")) {
                throw new Error("expecting a body surrounded by {} in syntax case");
            }

            // If infix, loop through the pattern separating the lhs and rhs.
            if (isInfix) {
                var pattern = cloneSyntax(casePattern).expose().token.inner;
                var lhs = [];
                var rhs = [];
                var separator = null;
                for (var j = 0; j < pattern.length; j++) {
                    if (separator) {
                        rhs.push(pattern[j]);
                    } else {
                        if (pattern[j].token.type === parser.Token.Punctuator &&
                            pattern[j].token.value === '|') {
                            separator = pattern[j];
                        } else {
                            lhs.push(pattern[j]);
                        }
                    }
                }
                if (!separator) {
                    throwSyntaxError("syntaxCase", "Infix macros require a `|` separator", casePattern);
                }
                cases.push({
                    lookbehind: loadPattern(lhs, true),
                    pattern: loadPattern(rhs),
                    body: caseBody.expose().token.inner
                });
            } else {
                cases.push({
                    lookbehind: [],
                    pattern: loadPattern(cloneSyntax(casePattern).expose().token.inner),
                    body: caseBody.expose().token.inner
                });
            }
        }

        function patternsToObject(pats) {
            if (!pats.length) {
                return makeDelim("[]", [], here);
            }

            var freshId = __fresh();
            context.patternMap.set(freshId, pats);

            return [
                makeIdent("getPattern", here),
                makeDelim("()", [
                    makeValue(freshId, here)
                ], here)
            ];
        }

        function makeMatch(caseObj) {
            var lhs = makeAssign("lhs", patternsToObject(caseObj.lookbehind));
            var rhs = makeAssign("rhs", patternsToObject(caseObj.pattern));

            var lhsMatch = makeAssign("lhsMatch", [
                makeIdent("patternModule", here),
                makePunc(".", here),
                makeIdent("matchLookbehind", here),
                makeDelim("()", [
                    makeIdent("lhs", name_stx),
                    makePunc(",", here),
                    makeIdent("prevStx", name_stx),
                    makePunc(",", here),
                    makeIdent("prevTerms", name_stx),
                    makePunc(",", here),
                    makeIdent("context", name_stx)
                ], here)
            ]);

            var rhsMatch = makeAssign("rhsMatch", [
                makeIdent("patternModule", here),
                makePunc(".", here),
                makeIdent("matchPatterns", here),
                makeDelim("()", [
                    makeIdent("rhs", name_stx),
                    makePunc(",", here),
                    makeIdent("arg", name_stx),
                    makePunc(",", here),
                    makeIdent("context", name_stx),
                    makePunc(",", here),
                    makeValue(true, here)
                ], here)
            ]);

            var mergeMatch = makeAssign("match", [
                makeIdent("mergeMatches", here),
                makeDelim("()", [
                    makeIdent("rhsMatch", name_stx),
                    makePunc(",", here),
                ].concat(
                    makeIdent("mergeMatches", here),
                    makeDelim("()", [
                        makeIdent("lhsMatch", name_stx),
                        makePunc(",", here),
                        makeIdent("parentMatch", name_stx)
                    ], here)
                ), here)
            ]);

            return lhs.concat(lhsMatch, [
                makeKeyword("if", here),
                makeDelim("()", [
                    makeIdent("lhsMatch", name_stx),
                    makePunc(".", here),
                    makeIdent("success", here)
                ], here),
                makeDelim("{}", rhs.concat(rhsMatch, [
                    makeKeyword("if", here),
                    makeDelim("()", [
                        makeIdent("rhsMatch", name_stx),
                        makePunc(".", here),
                        makeIdent("success", here)
                    ], here),
                    makeDelim("{}", mergeMatch.concat(makeTranscribe(caseObj)), here)
                ]), here)
            ]);
        }

        function makeTranscribe(caseObj) {
            // applyMarkToPatternEnv (context.mark, match.patternEnv);
            var applyPreMark = [
                makeIdent("applyMarkToPatternEnv", here),
                makeDelim("()", [
                    makeIdent("context", name_stx),
                    makePunc(".", here),
                    makeIdent("mark", name_stx),
                    makePunc(",", here),
                    makeIdent("match", name_stx),
                    makePunc(".", here),
                    makeIdent("patternEnv", name_stx)
                ], here),
                makePunc(";", here)
            ];
            // var res = (function() { <caseObj.body> })();
            var runBody = makeVarDef("res", [
                makeDelim("()", makeFunc([], caseObj.body), here),
                makeDelim("()", [], here)
            ]);
            // if (!Array.isArray(res)) { throwSyntaxError("macro", "Macro must return a syntax array", stx); }
            var errHandling = [
                makeKeyword("if", here),
                makeDelim("()", [
                    makePunc("!", here),
                    makeIdent("Array", here),
                    makePunc(".", here),
                    makeIdent("isArray", here),
                    makeDelim("()", [
                        makeIdent("res", name_stx)
                    ], here)
                ], here),
                makeDelim("{}", [
                    makeIdent("throwSyntaxError", here),
                    makeDelim("()", [
                        makeValue("macro", here),
                        makePunc(",", here),
                        makeValue("Macro must return a syntax array", here),
                        makePunc(",", here),
                        makeIdent("stx", name_stx)
                    ], here)
                ], here)
            ];
            // res = res.map(function(stx) { return stx.mark(context.mark); })
            var applyPostMark = [
                makeIdent("res", name_stx),
                makePunc("=", here),
                makeIdent("res", name_stx),
                makePunc(".", here),
                makeIdent("map", here),
                makeDelim("()", makeFunc([makeIdent("stx", here)], [
                        makeKeyword("return", here),
                        makeIdent("stx", here),
                        makePunc(".", here),
                        makeIdent("mark", here),
                        makeDelim("()", [
                            makeIdent("context", name_stx),
                            makePunc(".", here),
                            makeIdent("mark", here)
                        ], here)
                ]), here),
                makePunc(";", here)
            ];
            // return { result: res, rest: match.rest };
            var retResult = [
                makeKeyword("return", here),
                makeDelim("{}", [
                    makeIdent("result", here), makePunc(":", here),
                    makeIdent("res", name_stx),
                    makePunc(",", here),
                    makeIdent("rest", here), makePunc(":", here),
                    makeIdent("match", name_stx), makePunc(".", here), makeIdent("rest", here),
                    makePunc(",", here),
                    makeIdent("prevStx", here), makePunc(":", here),
                    makeIdent("lhsMatch", name_stx), makePunc(".", here), makeIdent("prevStx", here),
                    makePunc(",", here),
                    makeIdent("prevTerms", here), makePunc(":", here),
                    makeIdent("lhsMatch", name_stx), makePunc(".", here), makeIdent("prevTerms", here)
                ], here)
            ];
            return applyPreMark.concat(runBody, errHandling, applyPostMark, retResult);
        }

        var arg_def = makeVarDef("arg", [makeIdent("stx", name_stx)]);
        var name_def = makeVarDef("name_stx", [
            makeIdent("arg", name_stx),
            makeDelim("[]", [makeValue(0, here)], here)
        ]);
        var match_defs = [
            makeKeyword('var', here),
            makeIdent('lhs', name_stx), makePunc(',', here),
            makeIdent('lhsMatch', name_stx), makePunc(',', here),
            makeIdent('rhs', name_stx), makePunc(',', here),
            makeIdent('rhsMatch', name_stx), makePunc(',', here),
            makeIdent('match', name_stx), makePunc(',', here),
            makeIdent('res', name_stx), makePunc(';', here),
        ];

        var body = arg_def.concat(name_def, match_defs);

        for (var i = 0; i < cases.length; i++) {
            body = body.concat(makeMatch(cases[i]));
        }

        body = body.concat(quoteSyntax {
            throwSyntaxCaseError("Could not match any cases");
        });

        var res = makeFunc([
            makeIdent("stx", name_stx),
            makePunc(",", here),
            makeIdent("context", name_stx),
            makePunc(",", here),
            makeIdent("prevStx", name_stx),
            makePunc(",", here),
            makeIdent("prevTerms", name_stx),
            makePunc(",", here),
            makeIdent("parentMatch", name_stx)
        ], body).concat([
            makeDelim("()", arg_stx.concat([
                makePunc(",", here),
                makeKeyword("typeof", here),
                makeIdent("match", name_stx),
                makePunc("!==", here),
                makeValue("undefined", here),
                makePunc("?", here),
                makeIdent("match", name_stx),
                makePunc(":", here),
                makeDelim("{}", [], here)
            ]), here)
        ]);

        return {
            result: res,
            rest: stx.slice(3)
        }
    }
}
export syntaxCase


let macro = macro {
    function(stx) {
        var name_stx = stx[0];
        var here = quoteSyntax{here};
        var mac_name_stx;
        var body_inner_stx;
        var body_stx;
        var takeLine = patternModule.takeLine;
        var makeIdentityRule = patternModule.makeIdentityRule;
        var rest;

        if (stx[1] && stx[1].token.type === parser.Token.Delimiter &&
            stx[1].token.value === "{}") {
            mac_name_stx = null;
            body_stx = stx[1];
            body_inner_stx = stx[1].expose().token.inner;
            rest = stx.slice(2);
        } else {
            mac_name_stx = [];
            mac_name_stx.push(stx[1]);
            body_stx = stx[2];
            body_inner_stx = stx[2].expose().token.inner;
            rest = stx.slice(3);
        }

        function makeFunc(params, body) {
            return [
                makeKeyword("function", here),
                makeDelim("()", params, here),
                makeDelim("{}", body, here)
            ];
        }

        function translateRule(pattern, def, isInfix) {
            var translatedPatt;
            // When infix, we need to loop through the body and make sure there
            // is a separator to distinguish the lhs and rhs.
            if (isInfix) {
                translatedPatt = [];
                for (var i = 0, len = pattern.length; i < len; i++) {
                    translatedPatt.push(pattern[i]);
                    if (pattern[i].token.type === parser.Token.Punctuator &&
                        pattern[i].token.value === '|') {
                        translatedPatt.push(makeIdent("_", here));
                        translatedPatt = translatedPatt.concat([makeIdent("$", here),
                                                                makeDelim("()", pattern.slice(i + 1), here)]);
                        break;
                    }
                }
            } else {
                translatedPatt = [makeIdent("_", here),
                                  // wrapping the patterns in a group to disambiguate
                                  // `_ (foo) ...`
                                  // since the `(foo)` would be interpreted as a separator
                                  makeIdent("$", here),
                                  makeDelim("()", pattern, here)];
            }

            var translatedDef = [
                makeKeyword("return", here),
                takeLine(here[0], makeIdent("syntax", name_stx)),
                makeDelim("{}", def, here)
            ];

            return [makeIdent("case", here)].concat(
                isInfix ? makeIdent("infix", here) : [],
                makeDelim("{}", translatedPatt, here),
                makePunc("=>", here),
                makeDelim("{}", translatedDef, here)
            );
        }

        if (body_inner_stx[0] && body_inner_stx[0].token.value === "function") {

            if (mac_name_stx) {
                var res = [makeIdent("macro", here)].concat(mac_name_stx).concat(body_stx)
                return {
                    result: res,
                    rest: rest
                };
            } else {
                var res = [
                    makeIdent("macro", here),
                    body_stx
                ];
                return {
                    result: res,
                    rest: rest
                };
            }

        }
        
        var rules = [];
        var decl = body_inner_stx[0];
        
        if(decl) {
            
            var stxIdx = -4;
            var stxLen = body_inner_stx.length;
            var rulesLen = 0;
            
            while((stxIdx += 4) < stxLen) {
                
                decl = body_inner_stx[stxIdx];
                
                var def_stx, idRule;
                
                var infix = body_inner_stx[stxIdx + 1];
                var isInfix = !!(infix && infix.token && infix.token.value === "infix");
                var infixOffset = Number(isInfix);
                stxIdx += infixOffset;
                
                var def_pattern = body_inner_stx[stxIdx + 1];
                var def_arrow = body_inner_stx[stxIdx + 2];
                var def_body = body_inner_stx[stxIdx + 3];
                
                if(decl.token.value === "rule") {
                    
                    if(def_pattern && def_arrow && def_arrow.token.value === "=>" && def_body) {
                        def_stx = translateRule(def_pattern.expose().token.inner,
                                                def_body.expose().token.inner,
                                                isInfix);
                    } else if(def_pattern) {
                        idRule = makeIdentityRule(def_pattern.token.inner, isInfix, def_pattern);
                        def_stx = translateRule(idRule.pattern, idRule.body, isInfix);
                        stxIdx -= 2;
                    } else if(!def_stx) {
                        throwSyntaxError("macro", "Macro `macro` could not be matched" , def_arrow);
                    }
                    
                    decl = def_stx[0];
                    infix = def_stx[1];
                    def_pattern = def_stx[1 + infixOffset];
                    def_arrow = def_stx[2 + infixOffset];
                    def_body = def_stx[3 + infixOffset];
                    
                    def_stx = null;
                } else if(decl.token.value !== "case") {
                    throwSyntaxError("macro", "Macro `macro` could not be matched" , def_arrow);
                }
                
                rules[rulesLen++] = decl;
                if(isInfix) {
                    rules[rulesLen++] = infix;
                    rules[rulesLen++] = def_pattern;
                    rules[rulesLen++] = def_arrow;
                    rules[rulesLen++] = def_body;
                } else {
                    rules[rulesLen++] = def_pattern;
                    rules[rulesLen++] = def_arrow;
                    rules[rulesLen++] = def_body;
                }
            }
            
            rules = makeDelim("{}", rules, here);
        } else {
            rules = body_stx;
        }

        var stxSyntaxCase = takeLine(here[0], makeIdent("syntaxCase", name_stx));
        var res = mac_name_stx
            ? [makeIdent("macro", here)].concat(mac_name_stx)
            : [makeIdent("macro", here)];
        res = res.concat(makeDelim("{}", makeFunc([makeIdent("stx", name_stx),
                                                   makePunc(",", here),
                                                   makeIdent("context", name_stx),
                                                   makePunc(",", here),
                                                   makeIdent("prevStx", name_stx),
                                                   makePunc(",", here),
                                                   makeIdent("prevTerms", name_stx)],
                                                   [makeKeyword("return", here),
                                                    stxSyntaxCase,
                                                    makeDelim("()", [makeIdent("stx", name_stx),
                                                                     makePunc(",", here),
                                                                     makeIdent("context", name_stx),
                                                                     makePunc(",", here),
                                                                     makeIdent("prevStx", name_stx),
                                                                     makePunc(",", here),
                                                                     makeIdent("prevTerms", name_stx)], here),
                                                    rules]),
                                    here));


        return {
            result: res,
            rest: rest
        }
    }
}
export macro;

macro withSyntax_done {
    case { _ $ctx ($vars ...) {$rest ...} } => {
        var ctx = #{ $ctx };
        var here = #{ here };
        var vars = #{ $vars ... };
        var rest = #{ $rest ... };

        var res = [];

        for (var i = 0; i < vars.length; i += 3) {
            var name = vars[i];
            var repeat = !!vars[i + 1].token.inner.length;
            var rhs = vars[i + 2];

            if (repeat) {
                res.push(
                    makeIdent('match', ctx),
                    makePunc('.', here),
                    makeIdent('patternEnv', here),
                    makeDelim('[]', [makeValue(name.token.value, here)], here),
                    makePunc('=', here),
                    makeDelim('{}', [
                        makeIdent('level', here), makePunc(':', here), makeValue(1, here), makePunc(',', here),
                        makeIdent('match', here), makePunc(':', here), makeDelim('()', #{
                            (function(exp) {
                                return exp.length
                                    ? exp.map(function(t) { return { level: 0, match: [t] } })
                                    : [{ level: 0, match: [] }];
                            })
                        }, here), makeDelim('()', [rhs], here)
                    ], here),
                    makePunc(';', here)
                );
            } else {
                res.push(
                    makeIdent('match', ctx),
                    makePunc('.', here),
                    makeIdent('patternEnv', here),
                    makeDelim('[]', [makeValue(name.token.value, here)], here),
                    makePunc('=', here),
                    makeDelim('{}', [
                        makeIdent('level', here), makePunc(':', here), makeValue(0, here), makePunc(',', here),
                        makeIdent('match', here), makePunc(':', here), rhs
                    ], here),
                    makePunc(';', here)
                );
            }
        }

        res = res.concat(rest);
        res = [
            makeDelim("()", [
                makeKeyword("function", here),
                makeDelim("()", [makeIdent("match", ctx)], here),
                makeDelim("{}", res, here)
            ], here),
            makeDelim("()", [
                makeIdent("patternModule", here),
                makePunc(".", here),
                makeIdent("cloneMatch", here),
                makeDelim("()", [makeIdent("match", ctx)], here)
            ], here)
        ];

        return res;
    }
}

macro withSyntax_bind {
    rule { $name:ident $[...] = $rhs:expr } => {
        $name (true) $rhs
    }
    rule { $name:ident = $rhs:expr } => {
        $name () $rhs
    }
}

let withSyntax = macro {
    case { $name ($binders:withSyntax_bind (,) ...) { $body ... } } => {
        return #{
            withSyntax_done $name ($binders ...) { $body ... }
        }
    }
    case { $name ($binders:withSyntax_bind (,) ...) $quote:[#] { $body ... } } => {
        return #{
            withSyntax_done $name ($binders ...) {
                return $quote { $body ... }
            }
        }
    }
}
export withSyntax;

macro letstx_bind {
    rule { $name:ident = $rhs:expr , $more:letstx_bind } => {
        $name () $rhs $more
    }
    rule { $name:ident = $rhs:expr ;... letstx $more:letstx_bind } => {
        $name () $rhs $more
    }
    rule { $name:ident = $rhs:expr ;... } => {
        $name () $rhs
    }
    rule { $name:ident $[...] = $rhs:expr , $more:letstx_bind } => {
        $name (true) $rhs $more
    }
    rule { $name:ident $[...] = $rhs:expr ;... letstx $more:letstx_bind } => {
        $name (true) $rhs $more
    }
    rule { $name:ident $[...] = $rhs:expr ;... } => {
        $name (true) $rhs
    }
}

let letstx = macro {
    case { $name $binders:letstx_bind $rest ... } => {
        return #{
            return withSyntax_done $name ($binders) { $rest ... }
        }
    }
}
export letstx;


macro macroclass {
    rule { $name:ident { $decls:macroclass_decl ... } } => {
        macro $name {
            function (stx, context, prevStx, prevTerms) {
                var name_stx = stx[0];
                var match;
                macroclass_create $name stx context match ($decls ...)
            }
        }
    }
}

macro macroclass_decl {
    rule { $kw:[name] = $name:lit ;... } => {
        ($kw $name)
    }
    rule { $kw:[pattern] { $mods:macroclass_modifier ... } ;... } => {
        ($kw $mods ...)
    }
    rule { rule { $rule ... } ;... } => {
        (pattern (rule ($rule ...)))
    }
}

macro macroclass_modifier {
    rule { $kw:[name] = $name:lit ;... } => {
        ($kw $name)
    }
    rule { $kw:[rule] { $rule ... } ;... } => {
        ($kw ($rule ...))
    }
    rule { $kw:[with] $($lhs:macroclass_with_lhs = $rhs:macroclass_with_rhs) (,) ... } => {
        $(($kw ($lhs) ($rhs))) ...
    }
    rule { ; ;... } => { }
}

macro macroclass_with_lhs {
    rule { $name:ident $[...] }
    rule { $name:ident }
}

macro macroclass_with_rhs {
    rule { #{ $stx ... } }
    rule { $code:expr }
}

macro macroclass_create {
    function(stx, context, prevStx, prevTerms) {
        var here = quoteSyntax { here };
        var macName = stx[0];
        var nameStx = stx[1];
        var stxName = stx[2];
        var ctxName = stx[3];
        var matchName = stx[4];
        var decls = stx[5].expose().token.inner;
        var mclass = decls.reduce(function(m, decl) {
            var tag = unwrapSyntax(decl.token.inner[0]);
            if (tag === 'name') {
                if (m.name) {
                    throwSyntaxError('macroclass',
                                     'Duplicate name declaration',
                                     decl.token.inner[0])
                }
                m.name = unwrapSyntax(decl.token.inner[1]);
            } else if (tag === 'pattern') {
                var patternStx = decl.expose().token.inner.slice(1);
                var pattern = patternStx.reduce(function(p, mod) {
                    var tag = unwrapSyntax(mod.token.inner[0]);
                    if (tag === 'name') {
                        if (p.name) {
                            throwSyntaxError('macroclass',
                                             'Duplicate name declaration',
                                             mod.token.inner[0])
                        }
                        p.name = unwrapSyntax(mod.token.inner[1]);
                    } else if (tag === 'rule') {
                        if (p.rule) {
                            throwSyntaxError('macroclass',
                                             'Duplicate rule declaration',
                                             mod.token.inner[0])
                        }
                        p.rule = mod.expose().token.inner[1].expose().token.inner;
                    } else if (tag === 'with') {
                        mod.expose();
                        p.withs.push({
                            lhs: mod.token.inner[1].expose().token.inner,
                            rhs: mod.token.inner[2].expose().token.inner.map(function mapper(s) {
                                // We need to transplant syntax quotes so that it looks
                                // like they are within the macro body code and not
                                // the original code, otherwise it won't expand.
                                if (unwrapSyntax(s) === '#') {
                                    s.context = macName.context;
                                } else if (s.token.type === parser.Token.Delimiter) {
                                    s.expose();
                                    s.token.inner = s.token.inner.map(mapper);
                                }
                                return s;
                            })
                        });
                    }
                    return p;
                }, { withs: [] });
                m.patterns.push(pattern);
            }
            return m;
        }, { patterns: [] });

        var body = mclass.patterns.reduce(function(stx, pattern) {
            var ruleStx = [makeIdent('_', here)].concat(pattern.rule);
            var ruleId = __fresh();
            var rule = patternModule.loadPattern(ruleStx);

            context.patternMap.set(ruleId, rule);

            var withBindings = pattern.withs.reduce(function(acc, w) {
                return acc.concat(w.lhs.concat(makePunc('=', here), w.rhs, makePunc(',', here)));
            }, []);

            var ret = [
                makeKeyword('return', here), makeDelim('{}', [
                    makeIdent('result', here), makePunc(':', here), makeDelim('[]', [], here),
                    makePunc(',', here),
                    makeIdent('rest', here), makePunc(':', here),
                    matchName, makePunc('.', here), makeIdent('rest', here),
                    makePunc(',', here),
                    makeIdent('patterns', here), makePunc(':', here),
                    matchName, makePunc('.', here), makeIdent('patternEnv', here),
                ], here)
            ];

            var inner = ret;
            if (withBindings.length) {
                inner = [
                    makeKeyword('return', macName), makeIdent('withSyntax', macName),
                    makeDelim('()', withBindings, here),
                    makeDelim('{}', ret, here)
                ];
            }

            var res = [
                matchName, makePunc('=', here),
                makeIdent('patternModule', here), makePunc('.', here),
                makeIdent('matchPatterns', here), makeDelim('()', [
                    makeIdent('getPattern', here), makeDelim('()', [
                        makeValue(ruleId, here)
                    ], here),
                    makePunc(',', here), stxName,
                    makePunc(',', here), ctxName,
                    makePunc(',', here), makeValue(true, here)
                ], here),
                makePunc(';', here),
                makeKeyword('if', here), makeDelim('()', [
                    matchName, makePunc('.', here), makeIdent('success', here)
                ], here), makeDelim('{}', inner, here)
            ];
          
            return stx.concat(res);

        }, []);

        var res = body.concat(
            makeIdent('throwSyntaxCaseError', here),
            makeDelim('()', [
                makeValue(mclass.name || unwrapSyntax(nameStx), here), makePunc(',', here),
                makeValue('No match', here)
            ], here)
        );

        return {
            result: res,
            rest: stx.slice(6)
        };
    }
}

export macroclass;

macro safemacro {
    rule { $name:ident { rule $body ... } } => {
        let $name = macro {
            rule { : } => { $name : }
            rule infix { . | } => { . $name }
            rule $body ...
        }
    }
    rule { $name:ident { case $body ... } } => {
        let $name = macro {
            case { _ : } => { return #{ $name : } }
            case infix { . | _ } => { return #{ . $name } }
            case $body ...
        }
    }
}

macro op_assoc {
    rule { left }
    rule { right }
}

macro op_name {
    rule { ($name ...) }
    rule { $name } => { ($name) }
}

safemacro operator {
    rule {
        $name:op_name $prec:lit $assoc:op_assoc
        { $left:ident, $right:ident } => #{ $body ... }
    } => {
        binaryop $name $prec $assoc {
            macro {
                rule { ($left:expr) ($right:expr) } => { $body ... }
            }
        }
    }
    rule {
        $name:op_name $prec:lit { $op:ident } => #{ $body ... }
    } => {
        unaryop $name $prec {
            macro {
                rule { $op:expr } => { $body ... }
            }
        }
    }
}
export operator;

// macro __log {
//     case { _ defctx $stx } => {
//         var context = #{ $stx }[0].context;
//         console.log("defctx context for " + unwrapSyntax(#{$stx}) + "]");
//         while (context) {
//             if (context.defctx) {
//                 console.log(context.defctx.map(function(d) {
//                     return d.id.token.value
//                 }));
//             }
//             context = context.context;
//         }
//         return [];
//     }
//     case {_ rename $stx } => {
//         var context = #{ $stx }[0].context;
//         console.log("rename context for " + unwrapSyntax(#{$stx}) + ":");
//         while (context) {
//             if (context.name) {
//                 console.log("[name: " + context.name + ", id: " + context.id.token.value + "]");
//             }
//             context = context.context;
//         }
//         return [];
//     }
//     case {_ all $stx } => {
//         var context = #{ $stx }[0].context;
//         console.log("context for " + unwrapSyntax(#{$stx}) + ":");
//         while (context) {
//             if (context.name) {
//                 console.log("rename@[name: " + context.name + ", id: " + context.id.token.value + "]");
//             }
//             if (context.mark) {
//                 console.log("mark@[mark: " + context.mark + "]");
//             }
//             if (context.defctx) {
//                 console.log("defctx@[" + context.defctx.map(function(d) {
//                     return d.id.token.value
//                 }) + "]");
//             }
//             context = context.context;
//         }
//         return [];
//     }
// }
// export __log;
