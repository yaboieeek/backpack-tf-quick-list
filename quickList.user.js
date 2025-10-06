// ==UserScript==
// @name         QuickList
// @namespace    https://steamcommunity.com/profiles/76561198967088046
// @version      1.1.2
// @description  make listings faster without moving from your backpack page
// @author       eeek
// @match        https://backpack.tf/profiles/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=backpack.tf
// @updateURL https://github.com/yaboieeek/backpack-tf-quick-list/raw/refs/heads/main/quickList.user.js
// @downloadURL https://github.com/yaboieeek/backpack-tf-quick-list/raw/refs/heads/main/quickList.user.js
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @noframes
// ==/UserScript==

const cfg = {
    interfaceLinks: {
        createListing: 'https://backpack.tf/classifieds/listing'
    },

    icons: {
        publish: () => {
            const icon = document.createElement('i');
            icon.className = 'fa fa-arrow-right fa-times';
            return icon
        },
        cancel: () => {
            const icon = document.createElement('i');
            icon.className = 'fa fa-sw fa-times';
            return icon
        }
    },

    scriptDefaults: {
        startToggled: false,
        listingDelay: 0.5 * 1000,
    }
}

class UserInfo {
    fromPage() {
        return {
            userid: this.useridfrompage,
            trade_offer_url: this.tradeLink
        }
    }

    get useridfrompage() {
        const logoutLink = document.querySelector('a[href^="/logout"]');
        if (!logoutLink) {
            console.error('Logout link not found');
            return null;
        }

        const useridraw = logoutLink.getAttribute('href');
        console.log('Received a userid');
        return useridraw.replace('/logout?user-id=', '');
    }

    get tradeLink() {
        const savedTradelink = GM_getValue('tradelink');
        if (savedTradelink) {
            return savedTradelink;
        }

        const userLink = document.querySelector('.user-link');
        let tradelink;

        if (userLink && userLink.getAttribute('data-offers-params')) {
            tradelink = 'https://steamcommunity.com/tradeoffer/new/' +
                userLink.getAttribute('data-offers-params');
        } else {
            tradelink = prompt('Please, provide your tradelink');
            if (tradelink && !tradelink.includes('steamcommunity.com/tradeoffer/new/')) {
                alert('Please enter a valid Steam trade offer URL');
                return this.tradeLink;
            }
        }
        if (tradelink) {
            GM_setValue('tradelink', tradelink);
        }
        return tradelink;
    }
}

class Item{
    static fromElement(element, userinfo) {
        const data = element.dataset;
        const tradeData = {
            intent: "sell",
            trade_offer_url: userinfo.trade_offer_url,
            details: data?.listing_comment?? '',
            price: Item.getCurrencyBreakdown(data.listing_price),
            id: data.id,
            initialNode: element.parentNode,
            itemName: data.base_name || '',
            itemEffectName: data?.effect_name || ''
        };
        return tradeData
    }

    static getCurrencyBreakdown(currencyString = '') {
        const regex = /(\d+)\s*keys?(?:\s*[,-]?\s*(\d+(?:\.\d+)?)\s*ref)?|(\d+(?:\.\d+)?)\s*ref/i; //thank God ai exists and i dont have to fuck with regexp

        if (!currencyString) {
            return { keys: 0, metal: 0 };
        }

        const match = currencyString.match(regex);
        if (!match) {
            console.log('Error finding match');
            return { keys: 0, metal: 0 };
        }

        // match[1] - keys group 1 (keys + ref)
        // match[2] - metal group 1
        // match[3] - metal group 2 (ref only)
        return {
            keys: match[1] ? parseInt(match[1]) : 0,
            metal: match[2] ? parseFloat(match[2]) : (match[3] ? parseFloat(match[3]) : 0)
        };
    }
}

class Modal {
    constructor(userinfo) {
        this.listingsToMake = [];
        this.existingModels = [];
        this.userinfo = userinfo;
        this.modal = document.createElement('div');
        this.createModal();
        this.updateModal();
    }

    createModal() {
        const page = document.querySelector('#page-content');
        this.modal.className = 'quick-list-modal'

        const modalHeader = document.createElement('div');
        modalHeader.className = 'ql-modal-header modal-header';

        const modalBody = document.createElement('div');
        this.modalBody = modalBody;
        modalBody.className = 'modal-body';

        const toggleButton = document.createElement('button');
        const publishAllButton = document.createElement('button');
        const clearAllButton = document.createElement('button');

        toggleButton.addEventListener('click', () => this.toggleModal());
        clearAllButton.addEventListener('click', () => this.clearListings());
        publishAllButton.addEventListener('click', () => this.publishAll());


        toggleButton.className = 'toggle-modal-button btn btn-info';
        clearAllButton.className = 'ql-all-control btn btn-danger';
        publishAllButton.className = 'ql-all-control btn btn-success';

        const publishSpan = document.createElement('span');
        const removeSpan = document.createElement('span');

        publishSpan.innerText = 'Publish all';
        removeSpan.innerText = 'Clear';

        clearAllButton.append(removeSpan);
        publishAllButton.append(publishSpan);

        const crossIcon = document.createElement('i');
        crossIcon.className = 'fa fa-eye fa-times';
        toggleButton.append(crossIcon);

        modalHeader.append(publishAllButton, clearAllButton);
        this.modal.prepend(modalHeader, modalBody);
        page.append(this.modal, toggleButton);


        cfg.scriptDefaults.startToggled && this.toggleModal();
    }

    toggleModal() {
        this.modal.classList.toggle('hidden');
    }

    updateModal() {
        this.modal.querySelector('.modal-body').innerHTML = '';
        if (this.listingsToMake.length === 0) return this.modalBody.append(this.constructNoListingAlert());
        for (const item of this.listingsToMake) {
            const existingElem = this.existingModels.find((eitem) => eitem.data.id === item.dataset.id);
            if (existingElem) { 
                this.modalBody.append(existingElem.constructListing()); 
                continue; 
            }

            const itemListing = new ModalListingUIConstructor(item, this, this.userinfo);
            this.existingModels.push(itemListing);
            this.modalBody.append(itemListing.constructListing());
        }
    }

    addListing(item) {
        if (this.existingModels.some((model) => item.dataset.id === model.data.id)) return;
        this.listingsToMake.push(item);
        this.updateModal();
    }

    removeListing(item) {
        this.listingsToMake = this.listingsToMake.filter(eitem => eitem !== item);
        this.existingModels = this.existingModels.filter(model => model.data.id !== item.dataset.id);
        this.updateModal(); 
    }


    constructNoListingAlert() {
        const alertContainer = document.createElement('div');
        const alertHeader = document.createElement('h3');
        const alertBody = document.createElement('p');

        alertHeader.innerText = 'No listings to create!';
        alertBody.innerText = 'Start creating listings by holding Ctrl and clicking on an item in your backpack';
        alertContainer.append(alertHeader, alertBody);
        alertContainer.className = 'ql-listing ql-nothing';
        console.log(alertContainer);
        return alertContainer;
    }

    clearListings() {
        this.existingModels.forEach(model => model.removeListing());
    }

    async publishAll() {
        for (const listing of this.modalBody.querySelectorAll('.ql-listing')) {
            await this.delay(cfg.scriptDefaults.listDelay);
            listing.querySelector('.ql-publishlistingbutton').click();
        };
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
}

class ModalListingUIConstructor {
    constructor(itemElement, modal, userinfo) {
        this.userinfo = userinfo;
        this.itemElement = itemElement;
        this.modal = modal;
        this.data = {...this.userinfo, ...Item.fromElement(itemElement, this.userinfo)};
        this.state = '';
        this.listingElement = null;
        console.log(this.data);
    }

    constructListing() {
        const listingBody = document.createElement('div');
        this.listingElement = listingBody;
        const [listingTextArea, keyPriceArea, metalPriceArea] = [document.createElement('textarea'),document.createElement('input'),document.createElement('input')];
        const [keyLabel, metalLabel] = [document.createElement('label'),document.createElement('label')];
        const [removeFromQueryButton, publishListingButton] = [document.createElement('button'), document.createElement('button')];

        const priceContainer = document.createElement('div');
        const buttonsContainer = document.createElement('div');
        const controlsContainer = document.createElement('div');
        const [keyContainer, metalContainer] = [
            document.createElement('div'),
            document.createElement('div'),
        ]
        const calcWidth = (elem) => {
            let width = elem.value.length !== 0 ? elem.value.length + 2 : 4;
            if (elem.value.length > 5) width = 7;
            Object.assign(elem.style, {
                width: width + 'rem'
            })
        }

        listingTextArea.value = this.data.details;
        keyPriceArea.value = !!this.data.price.keys ?this.data.price.keys:'';
        metalPriceArea.value = !!this.data.price.metal ?this.data.price.metal: '';

        listingBody.className = 'ql-listing';
        listingTextArea.className = 'ql-textarea';
        keyPriceArea.className = 'ql-key';
        metalPriceArea.className = 'ql-metal';
        priceContainer.className = 'ql-pricecontainer';
        buttonsContainer.className = 'ql-buttonscontainer';
        removeFromQueryButton.className = 'ql-removebutton btn btn-danger';
        publishListingButton.className = 'ql-publishlistingbutton btn btn-success';
        controlsContainer.className = 'ql-controlscontainer';

        keyPriceArea.id = 'ql-keyprice';
        metalPriceArea.id = 'ql-metalprice';


        removeFromQueryButton.title = 'Remove this listing from the query';
        publishListingButton.title = 'Publish this listing';

        [keyPriceArea, metalPriceArea].forEach((e, index) => {
            e.inputmode = 'numeric';
            e.placeholder = '0';
            calcWidth(e);
            e.addEventListener('change',() => {
                calcWidth(e);
            });
            e.addEventListener('input', () => {
                calcWidth(e);
                if (index === 0) {
                    this.data.price.keys = e.value;
                } else {
                    this.data.price.metal = e.value;
                }
            })
        });

        listingTextArea.addEventListener('input', () => {
            this.data.details = listingTextArea.value;
        })

        keyLabel.htmlFor = 'ql-keyprice';
        metalLabel.htmlFor = 'ql-metalprice';

        keyLabel.innerText = 'Keys';
        metalLabel.innerText = 'Metal';
        keyLabel.className = 'ql-keylabel';
        metalLabel.className = 'ql-metallabel';
        keyContainer.className = 'ql-keycontainer';
        metalContainer.className = 'ql-metalcontainer';
        listingTextArea.placeholder = 'Your listing message...'
        listingTextArea.setAttribute('maxlength', 200);

        keyContainer.append(keyLabel, keyPriceArea);
        metalContainer.append(metalLabel, metalPriceArea);

        priceContainer.append(keyContainer, metalContainer);

        removeFromQueryButton.append(cfg.icons.cancel());
        publishListingButton.append(cfg.icons.publish());
        buttonsContainer.append(removeFromQueryButton, publishListingButton);
        controlsContainer.append(priceContainer, listingTextArea);

        removeFromQueryButton.addEventListener('click', () => this.removeListing());

        publishListingButton.addEventListener('click', () => {
            const params = this.constructParams(keyPriceArea.value, metalPriceArea.value, listingTextArea.value);
            this.updateState('listing-process');
            this.sendRequest(params).then(res => {
                this.updateState('success');
                iziToast.success({
                    title: `Success!`,
                    message: `Listing for ${this.data.itemEffectName ? this.data.itemEffectName + ' ' + this.data.itemName : this.data.itemName} is created!`
                })
                setTimeout(() => this.removeListing(), 500);
            }).catch(e => {
                this.updateState('fail');
                iziToast.error({
                    title: `Error!`,
                    message: `Failed to create listing for ${this.data.itemEffectName ? this.data.itemEffectName + ' ' + this.data.itemName : this.data.itemName}.${e}`
                })
            });
        });

        if (this.state) {
            this.updateState(this.state);
        }
        listingBody.append(this.itemElement, controlsContainer, buttonsContainer);

        this.itemElement.addEventListener('click', (e) => {

            const prevent = () => {
                e.preventDefault();
                e.stopPropagation();
            }

            e.ctrlKey && prevent()
        });
        return listingBody
    }

    removeListing() {
        this.modal.listingsToMake = this.modal.listingsToMake.filter(elem => elem !== this.itemElement);
        this.modal.existingModels = this.modal.existingModels.filter(model => model !== this);
        this.data.initialNode.prepend(this.itemElement);
        this.modal.updateModal();
    }

    async sendRequest(params) {
        try {
            const response = await fetch(this.constructLink(params), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams(params)
            });

            console.log(response);
            if (!response.ok) {
                const data = await response.json();
                throw (data?.message?? 'HTTP status 400!');
            }
        } catch (error) {
            throw error;
        }
    }

    constructLink(params) {
        return cfg.interfaceLinks.createListing;
    }

    constructParams(keys, metal, details) {
        return {
            intent:"sell",
            'currencies[metal]': metal || this.data.price.metal || 0,
            'currencies[keys]': keys || this.data.price.keys || 0,
            promoted: '0',
            buyout: "0",
            offers: "1",
            trade_offer_url: this.data.trade_offer_url,
            details: details || this.data.details,
            id: this.data.id,
            'user-id': this.data.userid
        }
    }

    updateState(newState) {
        if (!this.listingElement) return;
        this.listingElement.classList.remove('listing-process', 'success', 'fail');
        if (newState) {
            this.listingElement.classList.add(newState);
        }
        this.state = newState;
        const buttons = this.listingElement.querySelectorAll('button');
        const inputs = this.listingElement.querySelectorAll('input, textarea');
        const isDisabled = newState === 'listing-process';

        buttons.forEach(btn => btn.disabled = isDisabled);
        inputs.forEach(input => input.disabled = isDisabled);
    }

}


class App {
    constructor(userinfo) {
        this.userinfo = userinfo;
        console.log(userinfo);
        this.#checkForLoad();
    }

    #checkForLoad() {
        const handleLoadObserver = new MutationObserver((mutationRecord, obs) => {
            if (mutationRecord.length > 1) {
                obs.disconnect();
                this.#handleBackpack();
                this.modal = new Modal(this.userinfo);
            }
        });

        handleLoadObserver.observe(document.querySelector('#backpack'), {
            childList: true,
            subtree: true
        })
    }

    #handleBackpack() {
        console.log('BP WAS LOADED SUCCESFULLY');
        [...document.querySelectorAll('.item')].forEach(itemElement => {
            itemElement.addEventListener('click', (e) => {
                if(!e.ctrlKey) return;
                e.stopPropagation();
                this.modal.addListing(itemElement);
            });
        })
    }

}
const myID = document.querySelector('.username>a').getAttribute('href').replace('/profiles/', '');
if (window.location.pathname.endsWith(myID)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/izitoast@1.4.0/dist/css/iziToast.min.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/izitoast@1.4.0/dist/js/iziToast.min.js';
    document.head.appendChild(script);

    script.onload = () => {

        new App(new UserInfo().fromPage())
    };
}



GM_addStyle(`
.quick-list-modal {
    position: fixed;
    display: flex;
    flex-direction: column;
  height: 90%;
  width: 23%;
  background: white;
  top: 8%;
  right: 1%;
  border-radius: 5px;
}

.ql-modal-header {
    height: 4.1rem !important;
    width: 100%;
    display: flex;
    flex-direction: row;
    gap: 5px;
    align-items: center

}
.modal-body {
    overflow-y: scroll;
    height: 100%;
}

.toggle-modal-button {
display: flex;
align-items: center;
justify-content: center;
position: fixed;
  top: 8%;
  right: 1%;
  border-radius: 5px;
  border: none;
  font-size: 2rem;
  padding: 1rem;
  line-height: 0;
}

.ql-all-control {
    line-hegith: 1;
    min-height: 3rem;
}
.hidden {
    display: none;
}
.ql-textarea, .ql-key, .ql-metal {
    resize: none;
    border: 1px solid #eee;
    border-radius: 5px;
}

.ql-textarea {
    width: 225px;
    padding: 0.5rem 1rem;
}

.ql-listing {
    display: flex;
    margin-bottom: 1rem;
    border-radius: 5px;
    padding: 1rem;
    background: #eee;
    box-shadow: 4px 4px 5px rgba(0,0,0,.2)
}
.ql-pricecontainer {
    display: flex;
    flex-direction: row;
    font-size: 2rem;
    gap: 1rem;
    word-break: none;
}
.ql-buttonscontainer {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    margin-left: auto;
}

.ql-controlscontainer {
    margin-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
}

.ql-keylabel, .ql-metallabel {
    font-size: 12px !important;
    max-width: 100%;
  margin-bottom: 0px;
  font-weight: normal !important;
}

.ql-removebutton, .ql-publishlistingbutton {
    width: 3rem; height: 3rem;
    align-items: center;
    justify-content: center;
    display: flex;
    font-size: 2rem;
}

.ql-key, .ql-metal {
    max-width: 7rem;
    width: 4rem;
    height: 3rem
}

.ql-keycontainer, .ql-metalcontainer {
    display: flex;
    flex-direction: column
}

.popover {
    z-index: 999 !important;
    position: absolute !important
}

.success{
    background-color: #afa;
}
.fail{
    background-color: #faa;
}

.listing-process {
    background-color: #ffec85;
}

.ql-nothing {
    flex-direction: column !important;
    background-color: #dedeff !important;
    &h3 {
        margin-top: 5px !important;
    }
}
`)
