import util from '../util/util';
import OlTileGridWMTS from 'ol/tilegrid/wmts';
import OlSourceWMTS from 'ol/source/wmts';
import OlSourceTileWMS from 'ol/source/tilewms';
import OlLayerGroup from 'ol/layer/group';
import OlLayerTile from 'ol/layer/tile';
import OlTileGridTileGrid from 'ol/tilegrid/tilegrid';
import Style from 'ol/style/style';
import Circle from 'ol/style/circle';
import Fill from 'ol/style/fill';
import MVT from 'ol/format/mvt';
import Icon from 'ol/style/icon';
// import XYZ from 'ol/source/xyz';
import LayerVectorTile from 'ol/layer/vectortile';
import SourceVectorTile from 'ol/source/vectortile';
import lodashCloneDeep from 'lodash/cloneDeep';
import lodashMerge from 'lodash/merge';
import lodashEach from 'lodash/each';
import { lookupFactory } from '../ol/lookupimagetile';

export function mapLayerBuilder(models, config, cache, Parent) {
  var self = {};
  self.init = function (Parent) {
    self.extentLayers = [];
    Parent.events.on('selecting', hideWrap);
    Parent.events.on('selectiondone', showWrap);
  };
  /*
   * Create a new OpenLayers Layer
   *
   * @method createLayer
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers layer
   */
  self.createLayer = function (def, options) {
    var date, key, proj, layer, layerNext, layerPrior, attributes;

    options = options || {};
    key = self.layerKey(def, options);
    proj = models.proj.selected;
    layer = cache.getItem(key);
    if (!layer) {
      date = options.date || models.date.selected;
      attributes = {
        id: def.id,
        key: key,
        date: util.toISOStringDate(date),
        proj: proj.id,
        def: def
      };
      def = lodashCloneDeep(def);
      lodashMerge(def, def.projections[proj.id]);
      if (def.type === 'wmts') {
        layer = createLayerWMTS(def, options);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerWMTS(def, options, 1);
          layerPrior = createLayerWMTS(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }

      } else if (def.type === 'vector') {
        // If a custom palette is chosen, then set color.
        if(models.palettes.active[def.id]) {
          var palette = models.palettes.active[def.id].maps;
          var hexColor = models.palettes.getCustom(palette[0].custom).colors[0];
          var color = util.hexToRGBA(hexColor);
        }
        // TODO: add build step to add the default color to the layer config and pull in here
        // If you use a rendered layer's default color, set the default color.
        else if(config.palettes.rendered[def.id]) {
          var hexColor = config.palettes.rendered[def.id].maps[0].legend.colors[0];
          var color = util.hexToRGBA(hexColor);
        } else {
          // Set default color when layer is initially loaded. This should go away.
          var color = 'rgba(0,0,0,1)';
        }
        layer = createLayerVector(def, options, null, color);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerVector(def, options, 1);
          layerPrior = createLayerVector(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }

      } else if (def.type === 'wms') {
        layer = createLayerWMS(def, options);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerWMS(def, options, 1);
          layerPrior = createLayerWMS(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }
      } else {
        throw new Error('Unknown layer type: ' + def.type);
      }
      layer.wv = attributes;
      cache.setItem(key, layer);
      layer.setVisible(false);
    }
    layer.setOpacity(def.opacity || 1.0);
    return layer;
  };
  /*
   * Create a layer key
   *
   * @function layerKey
   * @static
   *
   * @param {Object} def - Layer properties
   *
   * @param {number} options - Layer options
   *
   * @returns {object} layer key Object
   */
  self.layerKey = function (def, options) {
    var layerId = def.id;
    var projId = models.proj.selected.id;
    var date;
    if (options.date) {
      date = util.toISOStringDate(options.date);
    } else {
      date = util.toISOStringDate(models.date.selected);
    }
    var dateId = (def.period === 'daily') ? date : '';
    var palette = '';
    if (models.palettes.isActive(def.id)) {
      palette = models.palettes.key(def.id);
    }
    return [layerId, projId, dateId, palette].join(':');
  };
  /*
   * Create a new WMTS Layer
   *
   * @method createLayerWMTS
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers WMTS layer
   */
  var createLayerWMTS = function (def, options, day) {
    var proj, source, matrixSet, matrixIds, extra,
      date, extent, start;
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];
    if (!source) {
      throw new Error(def.id + ': Invalid source: ' + def.source);
    }
    matrixSet = source.matrixSets[def.matrixSet];
    if (!matrixSet) {
      throw new Error(def.id + ': Undefined matrix set: ' + def.matrixSet);
    }
    if (typeof def.matrixIds === 'undefined') {
      matrixIds = [];
      lodashEach(matrixSet.resolutions, function (resolution, index) {
        matrixIds.push(index);
      });
    } else {
      matrixIds = def.matrixIds;
    }

    extra = '';

    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }

    if (def.period === 'daily') {
      date = options.date || models.date.selected;
      if (day) {
        date = util.dateAdd(date, 'day', day);
      }
      extra = '?TIME=' + util.toISOStringDate(date);
    }
    var sourceOptions = {
      url: source.url + extra,
      layer: def.layer || def.id,
      crossOrigin: 'anonymous',
      format: def.format,
      transition: 0,
      matrixSet: matrixSet.id,
      tileGrid: new OlTileGridWMTS({
        origin: start,
        resolutions: matrixSet.resolutions,
        matrixIds: matrixIds,
        tileSize: matrixSet.tileSize[0]
      }),
      wrapX: false,
      style: typeof def.style === 'undefined' ? 'default' : def.style
    };
    if (models.palettes.isActive(def.id)) {
      var lookup = models.palettes.getLookup(def.id);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    var layer = new OlLayerTile({
      extent: extent,
      source: new OlSourceWMTS(sourceOptions)
    });

    return layer;
  };

  /*
   * Create a new Vector Layer
   *
   * @method createLayerVector
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers Vector layer
   */
  var createLayerVector = function(def, options, day, color) {
    var proj, start, extent, source, matrixSet, matrixIds, res;
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];
    res = proj.resolutions;
    if (!source) { throw new Error(def.id + ': Invalid source: ' + def.source); }

    if (proj.id === 'geographic') {
      res = [0.28125, 0.140625, 0.0703125, 0.03515625, 0.017578125, 0.0087890625, 0.00439453125,
        0.002197265625, 0.0010986328125, 0.00054931640625, 0.00027465820313];
    }
    if (!source) {
      throw new Error(def.id + ': Invalid source: ' + def.source);
    }
    matrixSet = source.matrixSets[def.matrixSet];
    if (!matrixSet) {
      throw new Error(def.id + ': Undefined matrix set: ' + def.matrixSet);
    }
    if ('undefined' === typeof def.matrixIds) {
      matrixIds = [];
      lodashEach(matrixSet.resolutions, function(resolution, index) {
        matrixIds.push(index);
      });
    } else {
      matrixIds = def.matrixIds;
    }

    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }

    var vectorLayerDefaultStyle = new Style({
      image: new Circle({
        radius: 5,
        fill: new Fill({color: color}),
      })
    });
    var layerName = def.layer || def.id;
    var tms = def.matrixSet;
    console.log(tms);
    var sourceOptions = {
      format: new MVT(),
      wrapX: true,
      style: 'default',
      crossOrigin: 'anonymous',
      transition: 0,
      tileGrid: new OlTileGridTileGrid({
        origin: start,
        resolutions: res
      }),
      tilePixelRatio: 16,
      // http://cache2-sit.gibs.earthdata.nasa.gov/wmts/epsg4326/std/wmts.cgi?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=FIRMS_MODIS_v6&STYLE=&TILEMATRIXSET=16km&TILEMATRIX=0&TILEROW=0&TILECOL=0&TIME=2018-01-01&FORMAT=application%2Fvnd.mapbox-vector-tile
      // '&tilematrixset=' + tms
      url: source.url + '?layer=' + layerName + '&Service=WMTS&Request=GetTile&Version=1.0.0&FORMAT=application%2Fvnd.mapbox-vector-tile&TILEMATRIXSET=16km&TileMatrix={z}&TileCol={x}&TileRow={y}&TIME=2018-01-01',
    };
    var layer = new LayerVectorTile({
      extent: extent,
      source: new SourceVectorTile(sourceOptions),
      style: vectorLayerDefaultStyle
    });

    var setColorFromAttribute = true;
    if (setColorFromAttribute) {
      var newColor = util.rgbaToShortHex(color);
      layer.setStyle(function(feature, resolution) {
        var confidence = feature.get('CONFIDENCE');
        var dir = feature.get('dir');
        if(confidence) {
          var renderColor = util.changeHue(newColor, confidence);
          return [
            new Style({
              image: new Circle({
                radius: 5,
                fill: new Fill({color: renderColor}),
              }),
            })
          ];
        } else if(dir) {
          var radian = dir * Math.PI / 180;
          return [
            new Style({
              image: new Icon({
                src: 'images/up_arrow12white.png',
                imgSize: [12,12],
                rotation: radian,
              })
            })
          ];
        } else {
          var renderColor = color;
          return [
            new Style({
              image: new Circle({
                radius: 5,
                fill: new Fill({color: renderColor}),
              }),
            })
          ];
        }
      });
    }
    return layer;
  };

  /*
   * Create a new WMS Layer
   *
   * @method createLayerWMTS
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers WMS layer
   */
  var createLayerWMS = function (def, options, day) {
    var proj, source, extra, transparent,
      date, extent, start, res, parameters;
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];
    res = proj.resolutions;
    if (!source) { throw new Error(def.id + ': Invalid source: ' + def.source); }

    transparent = (def.format === 'image/png');
    if (proj.id === 'geographic') {
      res = [0.28125, 0.140625, 0.0703125, 0.03515625, 0.017578125, 0.0087890625, 0.00439453125,
        0.002197265625, 0.0010986328125, 0.00054931640625, 0.00027465820313];
    }
    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }
    parameters = {
      LAYERS: def.layer || def.id,
      FORMAT: def.format,
      TRANSPARENT: transparent,
      VERSION: '1.1.1'
    };
    if (def.styles) { parameters.STYLES = def.styles; }

    extra = '';

    if (def.period === 'daily') {
      date = options.date || models.date.selected;
      if (day) {
        date = util.dateAdd(date, 'day', day);
      }
      extra = '?TIME=' + util.toISOStringDate(date);
    }
    var sourceOptions = {
      url: source.url + extra,
      wrapX: true,
      style: 'default',
      crossOrigin: 'anonymous',
      params: parameters,
      transition: 0,
      tileGrid: new OlTileGridTileGrid({
        origin: start,
        resolutions: res
      })
    };

    if (models.palettes.isActive(def.id)) {
      var lookup = models.palettes.getLookup(def.id);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    var layer = new OlLayerTile({
      extent: extent,
      source: new OlSourceTileWMS(sourceOptions)
    });
    return layer;
  };
  var hideWrap = function () {
    var layer;
    var key;
    var layers;

    layers = models.layers.active;

    for (var i = 0, len = layers.length; i < len; i++) {
      layer = layers[i];
      if (layer.wrapadjacentdays && layer.visible) {
        key = self.layerKey(layer, {
          date: models.date.selected
        });
        layer = cache.getItem(key);
        layer.setExtent([-180, -90, 180, 90]);
      }
    }
  };
  var showWrap = function () {
    var layer;
    var layers;
    var key;

    layers = models.layers.active;
    for (var i = 0, len = layers.length; i < len; i++) {
      layer = layers[i];
      if (layer.wrapadjacentdays && layer.visible) {
        key = self.layerKey(layer, {
          date: models.date.selected
        });
        layer = cache.getItem(key);
        layer.setExtent([-250, -90, 250, 90]);
      }
    }
  };
  self.init(Parent);
  return self;
};
