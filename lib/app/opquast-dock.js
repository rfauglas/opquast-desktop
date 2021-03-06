/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Opquast Desktop.
 *
 * The Initial Developer of the Original Code is
 * Temesis SAS.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Fabrice Bonny <fabrice.bonny@temesis.com>
 *   Olivier Meunier <olivier.meunier@temesis.com>
 *   Mickael Hoareau <mickael.hoareau@temesis.com>
 *   Laurent Jouanneau <laurent@innophi.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */
"use strict";

const {Ci, Cc, Cr} = require("chrome");

const {Class} = require("sdk/core/heritage");
const {emit, on} = require("sdk/event/core");
const {EventTarget} = require("sdk/event/target");
const _ = require("sdk/l10n").get;
const self = require("sdk/self");
const {prefs} = require("sdk/simple-prefs");
const system = require("sdk/system");
const tabs = require("sdk/tabs");
const {setTimeout} = require("sdk/timers");

const {BaseDock, DockCache} = require("./dock");
const {ResultPanel} = require("./panels/results");
const {domTools} = require("../tools/dom-utils");

const wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

const dock_id = "opquast-desktop-dock";
const button_id = "opquast-desktop-button";


//
// Tab monitoring system
//
let tabListener = function(/* OpquastDock */ aDock) {
    this.dock = aDock;
};
tabListener.prototype = {
    QueryInterface: function(aIID) {
        if (aIID.equals(Ci.nsIWebProgressListener) ||
            aIID.equals(Ci.nsISupportsWeakReference) ||
            aIID.equals(Ci.nsISupports))
                return this;
        throw Cr.NS_NOINTERFACE;
    },

    onLocationChange: function(aProgress, aRequest, aURI) {
        try {
            // Allways hide first
            this.dock.hide();

            // If panel is found, show it
            let index = this.dock.selectPanel(aURI.spec);
            if (index !== undefined) {
                this.dock.show(index);
            }
        } catch(e) {
            if (prefs.debug) console.exception(e);
        }
    },
};


let TabMonitor = function TabMonitor(/* OpquastDock */ aDock) {
    this.dock = aDock;
};
TabMonitor.prototype = {
    init: function init() {
        this.listener = new tabListener(this.dock);

        this.onTabClose = function onTabClose(evt) {
            let location = this.dock.chromeWindow.gBrowser.getBrowserForTab(evt.target)
                            .documentURI.spec;

            // On tab close, we remove panel if this is the only tab with this URL
            let nbTab = 0;
            for (let tab of tabs) {
                if (tab.url == location) {
                    nbTab++
                }
            }
            if (nbTab <= 1) {
                this.dock.removePanel(location);
            }

        }.bind(this);

        this.dock.chromeWindow.gBrowser.addProgressListener(this.listener);
        this.dock.chromeWindow.gBrowser.tabContainer.addEventListener("TabClose", this.onTabClose, false);
    },

    destroy: function destroy() {
        this.dock.chromeWindow.gBrowser.removeProgressListener(this.listener);
        this.dock.chromeWindow.gBrowser.tabContainer.removeEventListener("TabClose", this.onTabClose, false);
    }
};


//
// Our dock with everything in it
//
let OpquastDock = Class({
    extends: BaseDock,

    init: function init() {
        BaseDock.prototype.init.call(this);
        this.tabMonitor = new TabMonitor(this);
        this.tabMonitor.init();
        console.debug("Dock created");
        this.deck.setAttribute('class', system.platform);
        this.deck.style.height = prefs.panelHeight + "px";
    },

    destroy: function destroy() {
        BaseDock.prototype.destroy.call(this);
        this.tabMonitor.destroy();
        console.debug("Dock destroyed");
    },

    /**
     * @deprecated e10s
     */
    getCurrentTabWindow: function getCurrentTabWindow() {
        return this.getCurrentTabBrowser().contentWindow;
    },

    getCurrentTabBrowser: function getCurrentTabBrowser() {
        return this.chromeWindow.gBrowser
                .getBrowserForTab(this.chromeWindow.gBrowser.selectedTab);
    },

    getCurrentURL: function getCurrentURL() {
        return this.getCurrentTabBrowser().documentURI.spec;
    },

    createPanel: function createPanel(aRunTests) {
        let box = BaseDock.prototype.createPanel.call(this, "vbox");
        box._url = this.getCurrentURL();
        box._panel = OpquastPanel(this, box, aRunTests);

        console.debug("Panel created");

        return box;
    },

    findPanel: function findPanel(aURL) {
        console.debug("Search panel with URL: " + aURL);
        if (this.deck.childElementCount) {
            for (let i=0; i<this.deck.children.length; i++) {
                if (this.deck.children[i]._url == aURL) {
                    return i;
                }
            }
        }
    },

    selectPanel: function selectPanel(aURL) {
        let index = this.findPanel(aURL);
        if (index !== undefined) {
            // Restore scroll position
            this.deck.selectedIndex = index;
            let panel = this.deck.children[index]._panel;
            setTimeout(panel.setScroll.bind(panel), 50);

            return index;
        }
    },

    removePanel: function removePanel(aURL) {
        let index = this.findPanel(aURL);
        if (index !== undefined) {
            let box = this.deck.children[index];
            emit(box._panel, "close");
            this.deck.removeChild(box);
            console.debug('Panel removed');
        }
    },

    open: function open() {
        if (!this.isVisible()) {
            this.show();
            console.debug('Dock opened');
        }
    },

    close: function close() {
        if (this.isVisible()) {
            this.removePanel(this.getCurrentURL());
            this.hide();
            console.debug('Dock closed');
        }
    },

    /**
     * @param boolean aRunTests force to show results it they exists and launch tests
     *                       if they don't exists
     */
    show: function show(aIndex, aRunTests) {
        console.debug('Show dock');
        BaseDock.prototype.show.call(this);

        let index = (aIndex !== undefined) ? aIndex : this.selectPanel(this.getCurrentURL());

        // Panel does not exist, create it
        if (index === undefined) {
            this.createPanel(aRunTests);
            this.deck.selectedIndex = this.deck.childElementCount - 1;
        }
    },

    showAndRun: function showAndRun() {
        if (!this.isVisible()) {
            this.show(undefined, true);
        } else {
            let index = this.selectPanel(this.getCurrentURL());
            this.deck.children[index]._panel.resultPanel.showUI(true);
        }
        console.debug('Dock shown and runned');
    }
});


//
// The main opquast panel
//
const OpquastPanel = Class({
    extends: EventTarget,

    /**
     * @param BaseDock/OpquastDock aDock
     * @param XULElement aBox  the box in which the panel content can be landing
     * @param boolean aRunTests force to show results it they exists and launch tests
     *                       if they don't exists, when the panel is building
     */
    initialize: function initialize(aDock, aBox, aRunTests) {
        this.dock = aDock;
        this.box = aBox;
        this.controls = {};
        this.scroll_position = [0, 0];

        let {$, _X} = domTools(this.dock.chromeDoc);

        this.deck = _X("deck", {
            "flex": 1,
            "class": this.dock.options.id + "-deck",
            "selectedIndex": 0
        });
        this.box.appendChild(this.deck);

        this.resultPanel = ResultPanel(this);
        this.resultPanel.once("ready", function(aForce) {
            this.showUI(aForce);
        }.bind(this.resultPanel, aRunTests));

        on(this, "close", this.onClose.bind(this));
    },

    setScroll: function setScroll() {
        let s = this.deck.selectedPanel;
        if (s && s.panelInstance !== undefined && s.panelInstance.setScroll !== undefined) {
            s.panelInstance.setScroll();
        }
    },

    onClose: function onClose() {
        for (let i=0; i<this.deck.children.length; i++) {
            emit(this.deck.children[i].panelInstance, "close");
        }
    }
});


//
// Dock options
//
exports.DockOptions = {
    "id": dock_id,
    "dockClass": OpquastDock,
    "stylesheet": self.data.url("panel/panel.css"),
};


//
// Menu and button command
//
let panelCmd = function(aRunTest, aCanClose) {
    aRunTest = typeof(aRunTest) === "undefined" ? false : aRunTest;
    aCanClose = typeof(aCanClose) === "undefined" ? true : aCanClose;

    try {
        let win = wm.getMostRecentWindow("navigator:browser");
        let dock = DockCache.getDock(win, dock_id);
        if (dock) {
            if (aRunTest) {
                dock.showAndRun();
            }
            else if (aCanClose && dock.isVisible()) {
                dock.close();
            }
            else {
                dock.open();
            }
        }
    }
    catch(e) {
        console.exception(e);
        console.log(e.stack);
        throw e;
    }
};

//
// Button options
//
exports.ButtonOptions = {
    id: button_id,
    label: "Opquast Desktop",
    icon: {
      "18": self.data.url("icon18.png"),
      "32": self.data.url("icon32.png"),
      "36": self.data.url("icon36.png"),
      "64": self.data.url("icon64.png")
    },
    onClick: panelCmd.bind(null, false)
};

//
// Menu
//
exports.MenuOptions = {
    id: "menu_opquastDesktop",
    menuid: "menuWebDeveloperPopup",
    insertbefore: "menu_devToolbox",
    label: "Opquast Desktop",
    image: self.data.url("icon16.png"),
    onCommand: panelCmd.bind(null, false, false)
};

//
// Hotkey
//
exports.HotkeyOptions = {
    combo: "control-alt-o",
    onPress: panelCmd.bind(null, false)
};

//
// Context menu
//
exports.CtxMenuOptions = {
    label: _("oqs.analyze_with_opquast"),
    image: self.data.url("icon16.png"),
    contentScript: 'self.on("click", self.postMessage);',
    onMessage: panelCmd.bind(null, true)
};
