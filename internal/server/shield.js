// The shield runs first in every web page Harf frames, before any of the
// page's own code. The page policy already blocks fetches, sockets, images,
// workers and forms; WebRTC is the one way out a policy cannot block, so the
// shield takes it away:
//
// - Every RTC constructor and navigator.mediaDevices are set to undefined,
//   locked so the page cannot put them back.
// - A frame would bring a fresh window with WebRTC of its own (srcdoc frames
//   run scripts and the policy does not stop them), so frames are removed as
//   soon as they are added, before they load. Shadow DOM is turned off, so
//   no frame can hide from that check. If a child window is left anyway, the
//   whole page is removed.
//
// Everything the checks call is copied before the page runs, so the page
// cannot change what they do.
(function () {
  'use strict';
  var w = window, O = Object, def = O.defineProperty, gopd = O.getOwnPropertyDescriptor, apply = Reflect.apply;
  var lock = function (obj, name, value) {
    try { def(obj, name, { value: value, writable: false, configurable: false, enumerable: false }); } catch (e) {}
  };
  var refuse = function () { throw new TypeError('not available in Harf pages'); };

  var names = O.getOwnPropertyNames(w);
  for (var i = 0; i < names.length; i++) if (/^(webkit|moz)?RTC/.test(names[i])) lock(w, names[i], undefined);
  lock(Navigator.prototype, 'mediaDevices', undefined);
  lock(Navigator.prototype, 'getUserMedia', undefined);
  lock(Navigator.prototype, 'webkitGetUserMedia', undefined);

  lock(Element.prototype, 'attachShadow', refuse);
  if ('setHTMLUnsafe' in Element.prototype) lock(Element.prototype, 'setHTMLUnsafe', refuse);
  if (typeof ShadowRoot !== 'undefined' && 'setHTMLUnsafe' in ShadowRoot.prototype) lock(ShadowRoot.prototype, 'setHTMLUnsafe', refuse);
  if ('parseHTMLUnsafe' in Document) lock(Document, 'parseHTMLUnsafe', refuse);
  // Written markup could hold a declarative shadow root; html blocks are
  // written in by the frame page with its own copy, taken before this runs.
  lock(Document.prototype, 'write', refuse);
  lock(Document.prototype, 'writeln', refuse);
  lock(Document.prototype, 'open', refuse);

  var doc = document;
  var childWindows = (gopd(w, 'length') || gopd(Window.prototype, 'length')).get;
  var root = gopd(Document.prototype, 'documentElement').get;
  var findAll = Document.prototype.querySelectorAll;
  var count = gopd(NodeList.prototype, 'length').get;
  var remove = Element.prototype.remove;
  var FRAMES = 'iframe, frame, object, embed, fencedframe, portal';

  var sweep = function () {
    var found = apply(findAll, doc, [FRAMES]);
    for (var i = apply(count, found, []) - 1; i >= 0; i--) apply(remove, found[i], []);
    if (apply(childWindows, w, []) > 0) {
      var r = apply(root, doc, []);
      if (r) apply(remove, r, []);
    }
  };
  new MutationObserver(sweep).observe(doc, { childList: true, subtree: true });
})();
