'use strict';

var events = require('events'),
    objutil = require('objutil');

var ORD = 0;

function createDict(str, del) {
    return str && Object.freeze(str.split(del || '').reduce(function (s, c) {
        s[c] = true;
        return s;
    }, {}));
}


function Parser(options) {
    var tags;
    options = options || {};
    this._state = Parser.State.BEGIN;
    this._closed = false;

    tags = options.tags;
    if (Array.isArray(tags)) {
        tags = tags.join(',');
    }

    this._tags = createDict(tags, /\s*,\s*/g);
    this._textNode = '';
    this._tagName = '';
    this._attributeName = '';
    this._attributeValue = '';
    this._attributes = {};
}


Parser.State = {
    BEGIN:        ORD++,
    TEXT:         ORD++,
    OPEN_CHAR:    ORD++,
    OPEN_TAG:     ORD++,
    ATTRIB:       ORD++,
    ATTRIB_NAME:  ORD++,
    ATTRIB_VALUE: ORD++,
    CLOSE_TAG:    ORD++
};


Parser.CharSet = {
    WHITESPACE: createDict('\n\r\t '),
    ALPHANUM:   createDict('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890._')
};


objutil.extend(Parser, events.EventEmitter, {

    _is: function (charSet, character) {
        return charSet[character];
    },

    _closeText: function () {
        if (this._textNode) {
            this.emit('text', this._textNode);
            this._textNode = '';
        }
    },

    _closeTag: function () {
        if (this._tagName) {
            this.emit('tag', {
                name: this._tagName,
                attributes: this._attributes
            });
        }
    },

    write: function (chunk) {
        var i, c, S;

        if (this._closed) {
            this.emit(new Error('Cannot write after close.'));
            return this;
        }

        if (chunk === null) {
            return this.end();
        }

        i = 0;
        S = Parser.State;

        while (c = chunk.charAt(i++)) {

            switch (this._state) {
                case S.BEGIN:
                    this._textNode = '';
                    this._state = S.TEXT;
                    // XXX: Intentionally fall through

                case S.TEXT:
                    this._tagName = '';
                    this._attributeName = '';
                    this._attributeValue = '';
                    this._attributes = {};

                    if (c === '{') {
                        this._state = S.OPEN_CHAR;
                    } else {
                        this._textNode += c;
                    }
                    break;

                case S.OPEN_CHAR:
                    if (c === '@') {
                        this._state = S.OPEN_TAG;
                    } else {
                        // Revert back to text state, including the previously skipped '{'
                        this._state = S.TEXT;
                        this._textNode += '{' + c;
                    }
                    break;

                case S.OPEN_TAG:
                    if (this._is(Parser.CharSet.ALPHANUM, c)) {
                        this._tagName += c;

                    } else if (this._is(Parser.CharSet.WHITESPACE, c)) {
                        if (this._tagName && (!this._tags || this._tags[this._tagName])) {
                            // Officially a tag so notify end of text node.
                            this._state = S.ATTRIB;
                        } else {
                            // Revert back to text state, including the character and continuing as text node.
                            this._textNode += '{@' + this._tagName + c;
                            this._state = S.TEXT;
                        }

                    } else if (c === '/') {
                        if (this._tagName && (!this._tags || this._tags[this._tagName])) {
                            // It's a tag w/ no attrs so close the prev textNode and initiate close
                            this._closeText();
                            this._state = S.CLOSE_TAG;
                        } else {
                            // Not a tag, but we got here somehow, so just add tag-like chars
                            this._textNode += '{@' + this._tagName + c;
                            this._state = S.TEXT;
                        }

                    } else {
                        if (this._tagName) {
                            throw new Error('Malformed tag. Tag not closed correctly.');
                        } else {
                            // Hit a character that's not valid in a tag, so put together what we've found so far and
                            // continue as text node.
                            this._textNode += '{@' + this._tagName + c;
                            this._state = S.TEXT;
                        }
                    }
                    break;

                case S.ATTRIB:
                    if (this._is(Parser.CharSet.ALPHANUM, c)) {
                        this._attributeName = c;
                        this._attributeValue = '';
                        this._state = S.ATTRIB_NAME;

                    } else if (this._is(Parser.CharSet.WHITESPACE, c)) {
                        // noop

                    } else if (c === '/') {
                        this._closeText();
                        this._state = S.CLOSE_TAG;

                    } else {
                        throw new Error('Malformed tag. Tag not closed correctly.');
                    }
                    break;

                case S.ATTRIB_NAME:
                    if (this._is(Parser.CharSet.ALPHANUM, c)) {
                        this._attributeName += c;

                    } else if (this._is(Parser.CharSet.WHITESPACE, c)) {
                        if (this._attributeName) {
                            this._attributes[this._attributeName] = this._attributeName;
                        }
                        this._state = S.ATTRIB;

                    } else if (c === '=') {
                        this._state = S.ATTRIB_VALUE;

                    } else if (c === '/') {
                        if (this._attributeName) {
                            this._attributes[this._attributeName] = this._attributeName;
                        }
                        this._state = S.CLOSE_TAG;

                    } else {
                        this._textNode += c;
                        this._state = S.TEXT;
                    }
                    break;

                case S.ATTRIB_VALUE:
                    if (c === '/') {
                        this._attributes[this._attributeName] = this._attributeValue;
                        this._state = S.CLOSE_TAG;

                    } else if (c === '"' || this._is(Parser.CharSet.WHITESPACE, c)) {
                        if (this._attributeValue) {
                            this._attributes[this._attributeName] = this._attributeValue;
                            this._state = S.ATTRIB;
                        }

                    } else {
                        this._attributeValue += c
                    }
                    break;

                case S.CLOSE_TAG:
                    if (c === '}') {
                        this._closeTag();
                        this._state = S.TEXT;
                    }
                    break;
            }

        }
        return this;
    },

    resume: function () {
        this._closed = false;
        return this;
    },


    end: function () {
        this._closed = true;
        this.emit('end');
        return this;
    },


    close: function () {
        if (this._closed) {
            throw new Error('Cannot write after close.');
        }
        this._closeText();
        return this.end();
    }

});


module.exports = Parser;