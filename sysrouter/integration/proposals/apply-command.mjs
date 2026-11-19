// apply-command.mjs — proposal (a) for Brit (PLAN 2C.4, SPEC D4, §9.2):
// Factors sendTxtFrom's inline command branch into _applyCommand(kind, by) and exposes
// SysRouterHost.command(kind, by) so fuzzy commands go through the exact same path.   // AUDIT-PHASE2 A13 (#28): _applyCommand handles halt, still, follow, unfollow only; boot.js must not offer or log acted for the other four kinds (SPEC §9.2 R2).

export function applyCommandProposal(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith('  if(typeof _getupBrainOn==="function"&&_getupBrainOn()&&(_fk==="halt"||_fk==="still"||_fk==="stop"))'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("  if(!_bsnd&&typeof _imitationRequest===\"function\""));
  const sendIdx = lines.findIndex((l) => l.startsWith("function sendTxtFrom(t,meta){"));
  if (start < 0 || end < 0 || sendIdx < 0) return { text, missing: ["apply-command"] };

  const helper = [
    'function _applyCommand(kind,by){',
    '  var _ftrk=null; try{ _ftrk=window._faceTrack||null; }catch(e){}',
    '  if(typeof _getupBrainOn==="function"&&_getupBrainOn()&&(kind==="halt"||kind==="still"||kind==="stop"))_brainSpeechHush++;',
    '  try{ if((kind==="halt"||kind==="still"||kind==="stop")&&typeof _partsHalt==="function") _partsHalt("words"); }catch(_ph){}',
    '  if(kind==="halt"||kind==="still"){ var _fo=!!(_ftrk&&_ftrk.owns), _fh=false;',
    '    try{ _fh=typeof _bodyHalt==="function"&&_bodyHalt(); }catch(e){}',
    '    if(_fo){ try{ _ftrk.disable({latch:true,save:false,release:true,by:by||"person",reason:"person_asked",message:"Tracking off for now, you asked me to stop"}); }catch(e){}',
    '      try{ if(window._ftEvent) window._ftEvent({state:"latched",by:by||"person",kind:kind,saved:0}); else logEv("face_track",{state:"latched",by:by||"person",kind:kind,saved:0}); }catch(e){}',
    '      toast("\\u2713 okay, not following you"); }',
    '    else if(_fh) toast("okay, staying down"); }',
    '  else if(_ftrk){',
    '    if(kind==="off"||kind==="stop"||kind==="unfollow"){',
    '      try{ _ftrk.disable({latch:true,release:true,by:by||"person",reason:"person_asked",message:"Tracking off, you asked me to stop"}); }catch(e){}',
    '      try{ if(window._ftEvent) window._ftEvent({state:"latched",by:by||"person",kind:kind==="unfollow"?"off":kind}); else logEv("face_track",{state:"latched",by:by||"person",kind:kind==="unfollow"?"off":kind}); }catch(e){}',
    '      toast("\\u2713 okay, not following you");',
    '    } else if(kind==="follow"&&_ftrk.personFollow){ /*GETUP-SPEED{*/if(!(typeof _gsLive==="function"&&_gsLive())){/*}GETUP-SPEED*/ try{ if(typeof _namedHandOff==="function") _namedHandOff("person"); }catch(_no){} /*LAB-GETUP{*/try{ if(typeof _recHandOff==="function") _recHandOff("person"); }catch(_ro){} /*}LAB-GETUP*/try{ _ftrk.personFollow(); }catch(e){} /*GETUP-SPEED{*/}/*}GETUP-SPEED*/ }',
    '  }',
    '}',
    'window.SysRouterHost=Object.assign(window.SysRouterHost||{},{command:function(kind,by){return _applyCommand(kind,by);}});'
  ].join("\n");

  const replacement = [
    '  var _cmdKind=_fk||(_fw.go?"follow":"");',
    '  if(_cmdKind) _applyCommand(_cmdKind,"person");'
  ];

  const out = [
    ...lines.slice(0, sendIdx),
    helper,
    ...lines.slice(sendIdx, start),
    ...replacement,
    ...lines.slice(end)
  ];
  return { text: out.join("\n"), missing: [] };
}
