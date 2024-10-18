/**
 * Credits:
 * 1. Buffer-based jitter-correction concept based on 
 * Stackoverflow user Martin Parenteau's answer
 * https://stackoverflow.com/questions/40324313/svg-smooth-freehand-drawing#40700068
 * 
 * 2. Polygon simplificatiohn based on
 * Vladimir Agafonkin's Simplify.js, 
 * mourner.github.io/simplify-js
 * 
 * 3. Chord-Length Parameterization 
 * based on
 * https://francoisromain.medium.com/smooth-a-svg-path-with-cubic-bezier-curves-e37b49d46c74
 */


/**
 * auto initialization
 */

let sigFields = document.querySelectorAll('[data-sigvg')
sigFields.forEach(field => {
    initSigVG({ target: field })
})


function initSigVG(options = {}) {

    let translationsDefault = {
        labelDelete: { en: 'Delete', de: 'Löschen' },
        labelExportSelect: { en: 'Save as', de: 'Speichern als' },
        labelStrokeWidth: { en: 'Stroke width', de: 'Strichstärke' },
    }

    // get options
    let optionsDefault = {
        // target
        target: document.body,
        targetOutput: null,
        width: 640,
        height: 360,
        strokeWidth: 2,

        // smoothing and simplification
        smooth: 4, // input jitter correction
        simplify: 0.25, // polygon simplification
        tension: 0.15, // tension for coord-parametrization smoothing
        decimals: 1, // coordinate rounding 

        //styles and classnames
        stroke: 'currentColor',
        className: 'sigvg',
        classPath: 'sigvg-path',
        classBtnClear: 'sigvg-btn-clear',

        // toolbar
        toolbar: [],

        // options for raster image export
        quality: 0.85,
        scale: 1,
        flattenTransparency: false,

        //language settings
        translations: {},
        language: 'en'
    }


    // data attribute options
    let optionsData = options.target ? (options.target.dataset.sigvg ? JSON.parse(options.target.dataset.sigvg) : {}) : {}

    options = {
        ...optionsDefault,
        ...options,
        ...optionsData
    }

    options.translations = {
        ...translationsDefault,
        ...options.translations
    }

    let { width, height, target, targetOutput, className, classPath, classBtnClear, strokeWidth, stroke, toolbar, quality, scale, flattenTransparency, smooth, simplify, tension, decimals, translations, language } = options;


    // toolbar markup
    let rgb2hex=c=>'#'+c.match(/\d+/g).map(x=>(+x).toString(16).padStart(2,0)).join('')
    let strokeCol = toolbar.includes('color') ? rgb2hex(window.getComputedStyle(target).color) : '#000';


    let toolbarBtns = {
        delete: `<button type="button" class="sigvg-button ${classBtnClear}" >${translations.labelDelete[language]}</button>`,
        download: `<select class="sigvg-select sigvg-select-download">
        <option value="">${translations.labelExportSelect[language]}</option>
        <option value="svg">SVG</option>
        <option value="webp">WebP</option>
        <option value="png">Png</option>
        <option value="jpg">Jpeg</option>
    </select>
    <a class="link-download" download="signature.svg"></a>`,
        color: `<div class="sigvg-input-color-wrap" ><input type="color" value="${strokeCol}" class="sigvg-input-color"></div>`,
        'stroke-width': `<div class="sigvg-input-stroke-width-wrap"><label>${translations.labelStrokeWidth[language]} <input type="range" value="1" steps="0.5" min="1" max="10" class="sigvg-input-stroke-width"></label></div>`
    }

    let  toolbarEls = '';
    toolbar.forEach(btn=>{
        toolbarEls +=toolbarBtns[btn];
    })

    toolbarEls = toolbar.length ? `<div class="sigvg-toolbar">${toolbarEls}</div>` : '';

    /**
     * create signature SVG pad
     * and append
     */
    let svgMarkup = `<div class="sigvg-wrap ${className}-wrap"><svg class="${className}" viewBox="0 0 ${width} ${height}"><path class="${classPath}" d="" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" /></svg>${toolbarEls}</div>`;

    //if target is field - insert after
    let fieldEls = ['input', 'textarea', 'button', 'select'];
    let isField = fieldEls.includes(target.nodeName.toLowerCase());

    // if target is field take it to store output
    if(isField) targetOutput=target;

    let insert = isField ? 'beforebegin' : 'beforeend';
    target.insertAdjacentHTML(insert, svgMarkup)

    // svg elements
    let svg = isField ? target.previousElementSibling.querySelector('svg') : target.querySelector(`.${className}`);
    let path = svg.querySelector(`.${classPath}`);

    // initial trans form matrix
    let ctm;

    /**
     * toolbar events
     */
    let btnClear = svg.parentNode.querySelector(`.${classBtnClear}`);
    let selectColor = svg.parentNode.querySelector('.sigvg-input-color');
    let selectDownload = svg.parentNode.querySelector(`.sigvg-select-download`);
    let linkDownload = svg.parentNode.querySelector(`.link-download`);
    let inputStrokeWidth = svg.parentNode.querySelector(`.sigvg-input-stroke-width`);


    // color
    if(selectColor){    
        selectColor.addEventListener('input', (e)=>{
            let color = e.currentTarget.value;
            //e.currentTarget.parentNode.style.backgroundColor =color;
            path.setAttribute('stroke',color )
        })
    }

    // stroke width
    if (inputStrokeWidth) {
        inputStrokeWidth.addEventListener('input', async (e) => {
            let value = +e.currentTarget.value;
            path.setAttribute('stroke-width', value)
        })
    }

    // file download
    if (selectDownload) {
        selectDownload.addEventListener('input', async (e) => {
            let format = e.currentTarget.value;
            let el = svg;

            // convert to file
            let fileUrl = await sigvgToFile(el, format, quality, scale, flattenTransparency);
            linkDownload.href = fileUrl;
            linkDownload.download = `signature.${format}`;
            linkDownload.click();

        })
    }



    // all points
    let pts = [];
    let ptsEnd = [];
    let drawing = false;

    //collect pathdata
    let pathData = []
    let pathDataSeg = []
    let pathDataStr = '';


    /**
     * point processing:
     * smoothing and optimization:
     * 1. input jitter correction: collect pointer coordinates to get average point
     * 2. simplify polygon
     * 3. polygon to bézier via Chord-Length Parameterization
     */

    smooth = 6;
    tension = 0.15;
    simplify = 0.3;
    decimals=1

    let bufferSize = smooth;
    let buffer = [];


    function updateSvgPath() {
        let pt = getAveragePoint(0);

        if (pt) {
            pathDataStr += ` ${pt.x} ${pt.y}`;
            pts.push(pt);

            /**
             * remaining points of a segment - 
             * only appended on draw end
             */
            let pathDataStrEnd = "";
            ptsEnd = [];

            for (let offset = Math.floor(buffer.length / 2); offset < buffer.length; offset += 2) {
                let ptN = getAveragePoint(offset);
                pathDataStrEnd += ` ${ptN.x} ${ptN.y}`;

                // add final segment pts
                ptsEnd.push(ptN);
            }

            // Set the complete current path coordinates
            path.setAttribute("d", pathDataStr + pathDataStrEnd);
        }
    };

    /**
     * end draw and optimize
     */
    function drawEnd() {

        // start new pathData for drawing
        if (pts.length > 1) {

            pts = [...pts, ...ptsEnd];

            // use simplify.js
            pts = simplifyPolygon(pts, simplify, true);

            /**
             * get path data and
             * optimize
            */
            pathDataSeg = getCurvePathData(pts, tension);
            pathData.push(...pathDataSeg)

            // convert to relative
            let pathDataConverted = JSON.parse(JSON.stringify(pathData)).toShorthands().toRelative(decimals)

            // render optimized path
            let d = pathDataConverted.toD(decimals, true);
            path.setAttribute('d', d)

            //return output
            if (targetOutput) targetOutput.value = pts.length ? new XMLSerializer().serializeToString(svg) : ''
        }

        // reset all
        buffer = [];
        pts = [];
        drawing = false;


    };


    function draw(e) {
        drawing = true;
        e.preventDefault();
        if (pts.length) {
            appendToBuffer(buffer, getMouseOrTouchPos(e, ctm));
            updateSvgPath();
        }
    }

    function drawStart(e) {
        e.preventDefault();
        drawing = true;
        let pt = getMouseOrTouchPos(e, ctm);
        appendToBuffer(buffer, pt);

        // init path: append to previous
        pts.push(pt)
        pathDataStr = path.getAttribute('d') + `M ${pt.x} ${pt.y}`;
        path.setAttribute("d", pathDataStr);
    }


    /**
     * event listeners
     */
    // start drawing: create new path;
    svg.addEventListener("mousedown", drawStart);
    svg.addEventListener("touchstart", drawStart);

    // while drawing: update path
    svg.addEventListener("mousemove", draw);
    svg.addEventListener("touchmove", draw);

    // stop drawing, reset point array for next line
    svg.addEventListener("mouseup", drawEnd);
    svg.addEventListener("touchend", drawEnd);
    svg.addEventListener("touchcancel", drawEnd);

    // leaving draw pad - stop drawing
    document.addEventListener("mouseup", drawEnd);
    svg.addEventListener("mouseleave", (e) => {

        if (pts.length) {
            setTimeout(() => {
                //add last point
                pts.push(getMouseOrTouchPos(e, ctm))
                drawEnd();

                if (!drawing) {
                }
            }, 100)
        }
    });



    //reset
    function clearDrawing(path, targetOutput = null) {
        path.setAttribute('d', '')
        pathDataStr = '';
        pts = [];
        pathData = [];
        pathDataSeg = [];
        if (targetOutput) targetOutput.value = '';
    }

    if (btnClear) {
        btnClear.onclick = () => {
            clearDrawing(path, targetOutput)
        }
    }



    function getMouseOrTouchPos(e, ctm) {
        let x, y;

        // touch cooordinates
        if (
            e.type == "touchstart" ||
            e.type == "touchmove" ||
            e.type == "touchend" ||
            e.type == "touchcancel"
        ) {
            let evt = typeof e.originalEvent === "undefined" ? e : e.originalEvent;
            let touch = evt.touches[0] || evt.changedTouches[0];
            x = touch.pageX - window.scrollX;
            y = touch.pageY - window.scrollY;
        } else if (
            e.type == "mousedown" ||
            e.type == "mouseup" ||
            e.type == "mousemove" ||
            e.type == "mouseover" ||
            e.type == "mouseout" ||
            e.type == "mouseenter" ||
            e.type == "mouseleave"
        ) {
            x = e.pageX - window.scrollX;
            y = e.pageY - window.scrollY;
        }

        // get svg user space coordinates
        let pt = new DOMPoint(x, y);
        ctm = svg.getScreenCTM().inverse();
        pt = pt.matrixTransform(ctm);
        return { x: pt.x, y: pt.y };
    }


    function appendToBuffer(buffer, pt) {
        buffer.push(pt);
        if(buffer.length<2) return;

        for (let i = buffer.length; i > bufferSize; i--) {
            buffer.shift();
        }
    };

    // Calculate the average point, starting at offset in the buffer
    function getAveragePoint(offset) {
        if(buffer.length<2) return buffer[0];

        let pts = buffer.slice(offset);
        let totalX = pts.reduce((sum, pt) => sum + pt.x, 0);
        let totalY = pts.reduce((sum, pt) => sum + pt.y, 0);
        let ptA = { x: totalX / pts.length, y: totalY / pts.length }
        return ptA;
    };



    async function sigvgToFile(el, format, quality = 0.9, scale = 1, flattenTransparency = false) {

        //normalize format string
        format = format.toLowerCase().replaceAll('jpeg', 'jpg')

        /**
         *  clone svg to add width and height
         * for better compatibility
         * without affecting the original svg
         */
        const svgEl = el.cloneNode(true);

        // get dimensions
        let { width, height } = el.getBBox();
        let w = el.viewBox.baseVal.width
            ? svgEl.viewBox.baseVal.width
            : el.width.baseVal.value
                ? el.width.baseVal.value
                : width;
        let h = el.viewBox.baseVal.height
            ? svgEl.viewBox.baseVal.height
            : el.height.baseVal.value
                ? el.height.baseVal.value
                : height;

        // apply scaling for canvas export
        [w, h] = [w * scale, h * scale];

        // add width and height for firefox compatibility
        svgEl.setAttribute("width", w);
        svgEl.setAttribute("height", h);


        // set stroke color from CSS
        let path = el.querySelector('path')
        let strokeCol = window.getComputedStyle(path).stroke;
        let pathClone = svgEl.querySelector('path')
        pathClone.setAttribute('stroke', strokeCol)


        let svgString = new XMLSerializer().serializeToString(svgEl);
        let blob = new Blob([svgString], { type: "image/svg+xml" });
        let objectURL = URL.createObjectURL(blob);

        if (format === 'svg') {
            return objectURL
        }
        // export raster image
        else {
            // create canvas
            let canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;


            let tmpImg = new Image();
            tmpImg.src = objectURL;
            tmpImg.width = w;
            tmpImg.height = h;
            tmpImg.crossOrigin = "anonymous";

            await tmpImg.decode();
            let ctx = canvas.getContext("2d");
            if (format === 'jpg' || flattenTransparency) {
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, w, h);
            }

            ctx.drawImage(tmpImg, 0, 0, w, h);

            //create img data URL
            let type = format === 'jpg' ? 'image/jpeg' : (format === 'webp' ? 'image/webp' : 'image/png');
            let dataUrl = await canvas.toDataURL(type, quality);
            return dataUrl;

        }

    }

}



/**
* Chord-Length Parameterization 
* based on
* https://francoisromain.medium.com/smooth-a-svg-path-with-cubic-bezier-curves-e37b49d46c74
*/

// Render the svg <path> element
function getCurvePathData(points, smoothing = 0.2, closed = false) {

    // append first 2 points for closed paths
    if (closed) {
        points = points.concat(points.slice(0, 2));
    }

    // Properties of a line
    const line = (pointA, pointB) => {
        let lengthX = pointB.x - pointA.x;
        let lengthY = pointB.y - pointA.y;
        return {
            length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)),
            angle: Math.atan2(lengthY, lengthX)
        };
    };

    // Position of a control point
    const controlPoint = (current, previous, next, reverse = false) => {
        let p = previous || current;
        let n = next || current;
        let o = line(p, n);

        let angle = o.angle + (reverse ? Math.PI : 0);
        let length = o.length * smoothing;

        let x = current.x + Math.cos(angle) * length;
        let y = current.y + Math.sin(angle) * length;
        return { x, y };
    };

    let pathData = [];
    pathData.push({ type: "M", values: [points[0].x, points[0].y] });

    for (let i = 1; i < points.length; i++) {
        let point = points[i];
        let cp1 = controlPoint(points[i - 1], points[i - 2], point);
        let cp2 = controlPoint(point, points[i - 1], points[i + 1], true);

        let command = {
            type: "C",
            values: [cp1.x, cp1.y, cp2.x, cp2.y, point.x, point.y]
        };

        pathData.push(command);
    }

    // copy last commands 1st controlpoint to first curveto
    if (closed) {
        let comLast = pathData[pathData.length - 1];
        let valuesLastC = comLast.values;
        let valuesFirstC = pathData[1].values;

        pathData[1] = {
            type: "C",
            values: [valuesLastC[0], valuesLastC[1], valuesFirstC.slice(2)].flat()
        };
        // delete last curveto
        pathData = pathData.slice(0, pathData.length - 1);
        pathData.push({ type: 'z', values: [] })

    }

    return pathData;
};


/**
 * convert path data
 */

Array.prototype.toRelative = function (decimals = -1) {
    return pathDataToRelative(this, decimals);
}

/**
     * This is just a port of Dmitry Baranovskiy's 
     * pathToRelative/Absolute methods used in snap.svg
     * https://github.com/adobe-webplatform/Snap.svg/
     * 
     * Demo: https://codepen.io/herrstrietzel/pen/poVKbgL
     */

// convert to relative commands
function pathDataToRelative(pathData, decimals = -1) {

    // round coordinates to prevent distortions
    if (decimals >= 0) {
        pathData[0].values = pathData[0].values.map(val => { return +val.toFixed(decimals) })
    }

    let M = pathData[0].values;
    let x = M[0],
        y = M[1],
        mx = x,
        my = y;


    // loop through commands
    for (let i = 1; i < pathData.length; i++) {
        let com = pathData[i];

        // round coordinates to prevent distortions
        if (decimals >= 0 && com.values.length) {
            com.values = com.values.map(val => { return +val.toFixed(decimals) })
        }
        let { type, values } = com;
        let typeRel = type.toLowerCase();


        // is absolute
        if (type != typeRel) {
            type = typeRel;
            com.type = type;
            // check current command types
            switch (typeRel) {
                case "a":
                    values[5] = +(values[5] - x);
                    values[6] = +(values[6] - y);
                    break;
                case "v":
                    values[0] = +(values[0] - y);
                    break;
                case "m":
                    mx = values[0];
                    my = values[1];
                default:
                    // other commands
                    if (values.length) {
                        for (let v = 0; v < values.length; v++) {
                            // even value indices are y coordinates
                            values[v] = values[v] - (v % 2 ? y : x);
                        }
                    }
            }
        }
        // is already relative
        else {
            if (type == "m") {
                mx = values[0] + x;
                my = values[1] + y;
            }
        }
        let vLen = values.length;
        switch (type) {
            case "z":
                x = mx;
                y = my;
                break;
            case "h":
                x += values[vLen - 1];
                break;
            case "v":
                y += values[vLen - 1];
                break;
            default:
                x += values[vLen - 2];
                y += values[vLen - 1];
        }
        // round final relative values
        if (decimals > -1) {
            com.values = com.values.map(val => { return +val.toFixed(decimals) })
        }
    }
    return pathData;
}


Array.prototype.toShorthands = function (decimals = -1) {
    return pathDataToShorthands(this, decimals);
}


/**
 * apply shorthand commands if possible
 * L, L, C, Q => H, V, S, T
 * reversed method: pathDataToLonghands()
 */
function pathDataToShorthands(pathData, decimals = -1, test = true) {

    /** 
     * analyze pathdata – if you're sure your data is already absolute skip it via test=false
    */
    let hasRel
    if (test) {
        let commandTokens = pathData.map(com => { return com.type }).join('')
        hasRel = /[astvqmhlc]/g.test(commandTokens);
    }

    pathData = test && hasRel ? pathDataToAbsolute(pathData, decimals) : pathData;
    let comShort = {
        type: "M",
        values: pathData[0].values
    };
    let pathDataShorts = [comShort];
    for (let i = 1; i < pathData.length; i++) {
        let com = pathData[i];
        let { type, values } = com;
        let valuesL = values.length;
        let comPrev = pathData[i - 1];
        let valuesPrev = comPrev.values;
        let valuesPrevL = valuesPrev.length;
        let [x, y] = [values[valuesL - 2], values[valuesL - 1]];
        let cp1X, cp1Y, cp2X, cp2Y;
        let [prevX, prevY] = [
            valuesPrev[valuesPrevL - 2],
            valuesPrev[valuesPrevL - 1]
        ];
        let val0R, cpN1XR, val1R, cpN1YR, cpN1X, cpN1Y, cpN2X, cpN2Y, prevXR, prevYR;

        switch (type) {
            case "L":
                // round coordinates for some tolerance
                [val0R, prevXR, val1R, prevYR] = [
                    values[0],
                    prevX,
                    values[1],
                    prevY
                ]

                if (comPrev.type !== 'H' && comPrev.type !== 'V') {
                    [val0R, prevXR, val1R, prevYR] = [val0R, prevXR, val1R, prevYR].map((val) => {
                        return +(val).toFixed(2);
                    });
                }

                if (prevYR == val1R && prevXR !== val0R) {
                    comShort = {
                        type: "H",
                        values: [values[0]]
                    };
                } else if (prevXR == val0R && prevYR !== val1R) {
                    comShort = {
                        type: "V",
                        values: [values[1]]
                    };
                } else {
                    comShort = com;
                }
                break;
            case "Q":
                [cp1X, cp1Y] = [valuesPrev[0], valuesPrev[1]];
                [prevX, prevY] = [
                    valuesPrev[valuesPrevL - 2],
                    valuesPrev[valuesPrevL - 1]
                ];
                // Q control point
                cpN1X = prevX + (prevX - cp1X);
                cpN1Y = prevY + (prevY - cp1Y);

                /**
                * control points can be reflected
                * use rounded values for better tolerance
                */
                [val0R, cpN1XR, val1R, cpN1YR] = [
                    values[0],
                    cpN1X,
                    values[1],
                    cpN1Y
                ].map((val) => {
                    return +(val).toFixed(1);
                });

                if (val0R == cpN1XR && val1R == cpN1YR) {
                    comShort = {
                        type: "T",
                        values: [x, y]
                    };
                } else {
                    comShort = com;
                }
                break;
            case "C":
                [cp1X, cp1Y] = [valuesPrev[0], valuesPrev[1]];
                [cp2X, cp2Y] =
                    valuesPrevL > 2 ?
                        [valuesPrev[2], valuesPrev[3]] :
                        [valuesPrev[0], valuesPrev[1]];
                [prevX, prevY] = [
                    valuesPrev[valuesPrevL - 2],
                    valuesPrev[valuesPrevL - 1]
                ];
                // C control points
                cpN1X = 2 * prevX - cp2X;
                cpN1Y = 2 * prevY - cp2Y;
                cpN2X = values[2];
                cpN2Y = values[3];

                /**
                * control points can be reflected
                * use rounded values for better tolerance
                */
                [val0R, cpN1XR, val1R, cpN1YR] = [
                    values[0],
                    cpN1X,
                    values[1],
                    cpN1Y
                ].map((val) => {
                    return +(val).toFixed(1);
                });

                if (val0R == cpN1XR && val1R == cpN1YR) {
                    comShort = {
                        type: "S",
                        values: [cpN2X, cpN2Y, x, y]
                    };
                } else {
                    comShort = com;
                }
                break;
            default:
                comShort = {
                    type: type,
                    values: values
                };
        }

        // round final values
        if (decimals > -1) {
            comShort.values = comShort.values.map(val => { return +val.toFixed(decimals) })
        }

        pathDataShorts.push(comShort);
    }
    return pathDataShorts;
}

// convert pathdata to d attribute string
// wrapper for stringified path data output
Array.prototype.toD = function (decimals = -1, minify = false) {
    return pathDataToD(this, decimals, minify);
}

/**
 * serialize pathData array to 
 * d attribute string 
 */
function pathDataToD(pathData, decimals = -1, minify = false) {

    // implicit l command
    if (pathData[1].type === "l" && minify) {
        pathData[0].type = "m";
    }
    let d = `${pathData[0].type}${pathData[0].values.join(" ")}`;

    for (let i = 1; i < pathData.length; i++) {
        let com0 = pathData[i - 1];
        let com = pathData[i];
        let { type, values } = com;

        // minify arctos
        if (minify && type === 'A' || type === 'a') {
            values = [values[0], values[1], values[2], [values[3], values[4], values[5]].join(''), values[6]]
        }

        // round
        if (values.length && decimals > -1) {
            values = values.map(val => { return typeof val === 'number' ? +val.toFixed(decimals) : val })
        }

        // omit type for repeated commands
        type = (com0.type === com.type && com.type.toLowerCase() != 'm' && minify) ?
            " " : (
                (com0.type === "m" && com.type === "l") ||
                (com0.type === "M" && com.type === "l") ||
                (com0.type === "M" && com.type === "L")
            ) && minify ?
                " " : com.type;

        d += `${type}${values.join(" ")}`;
    }

    if (minify) {
        d = d
            .replaceAll(" 0.", " .")
            .replaceAll(" -", "-")
            .replaceAll("-0.", "-.")
            .replaceAll("Z", "z");
    }
    return d;
}




/*
 (c) 2017, Vladimir Agafonkin
 Simplify.js, a high-performance JS polyline simplification library
 mourner.github.io/simplify-js
*/

// to suit your point format, run search/replace for '.x' and '.y';
// for 3D version, see 3d branch (configurability would draw significant performance overhead)

// square distance between 2 points
function getSqDist(p1, p2) {

    let dx = p1.x - p2.x,
        dy = p1.y - p2.y;

    return dx * dx + dy * dy;
}

// square distance from a point to a segment
function getSqSegDist(p, p1, p2) {

    let x = p1.x,
        y = p1.y,
        dx = p2.x - x,
        dy = p2.y - y;

    if (dx !== 0 || dy !== 0) {

        let t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);

        if (t > 1) {
            x = p2.x;
            y = p2.y;

        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }

    dx = p.x - x;
    dy = p.y - y;

    return dx * dx + dy * dy;
}


function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    let maxSqDist = sqTolerance,
        index;

    for (let i = first + 1; i < last; i++) {
        let sqDist = getSqSegDist(points[i], points[first], points[last]);

        if (sqDist > maxSqDist) {
            index = i;
            maxSqDist = sqDist;
        }
    }

    if (maxSqDist > sqTolerance) {
        if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
        simplified.push(points[index]);
        if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
}

// simplification using Ramer-Douglas-Peucker algorithm
function simplifyDouglasPeucker(points, sqTolerance) {
    let last = points.length - 1;

    let simplified = [points[0]];
    simplifyDPStep(points, 0, last, sqTolerance, simplified);
    simplified.push(points[last]);

    return simplified;
}

// both algorithms combined for awesome performance
function simplifyPolygon(points, tolerance = 0.5) {

    if (points.length <= 2) return points;
    let sqTolerance = tolerance !== undefined ? tolerance * tolerance : 1;
    points = simplifyDouglasPeucker(points, sqTolerance);

    return points;
}


