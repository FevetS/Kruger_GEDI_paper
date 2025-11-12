// Run CCDC on each MGRS tile for the study area
// This was run once with only L30 and once with L30+S30
// It requires Paulo's ccdcUtilities

var utils = require('users/parevalo_bu/gee-ccdc-tools:ccdcUtilities/api')
var hlstools = require('users/jcvogeler/VogelerLab:Modules/hls.js')

var aoi = ee.FeatureCollection('users/stevenf/ecofor/greaterkruger_utm36n')
var tiles = ee.FeatureCollection('users/stevenf/ecofor/mgrs_utm36n')
// tiles = ee.FeatureCollection(tiles.toList(1)) // Testing on one tile

// Map.addLayer(tiles, {}, 'tiles')
// Map.addLayer(aoi)

var tjson = tiles.getInfo()
// print(tjson)

for (var i=0; i < tjson['features'].length; i++){
  var tile = tjson['features'][i]
  var tprops = tile['properties'];
  print(tile)
  
  // Get HLS collection
  var tile_geo = ee.Geometry(tile['geometry'])
  
  var l30_filter = ee.Filter.and(
    ee.Filter.lt('CLOUD_COVERAGE', 80),
    ee.Filter.stringStartsWith('system:index', 'T'.concat(tprops['name']))
    )
  
  var s2_filter = ee.Filter.and(
    ee.Filter.lt('CLOUDY_PIXEL_OVER_LAND_PERCENTAGE', 80),
    ee.Filter.eq('MGRS_TILE', tprops['name'])
  )
  
  // var imgs = hlstools.get_hls_collection(tile_geo, '2013-01-01', '2024-01-01', l30_filter, s2_filter)
  var imgs = hlstools.get_l30_collection(tile_geo, '2013-01-01', '2024-01-01', l30_filter)
  // print(imgs)  
  
  // Resample imagery to match output CRS transform BEFORE running CCDC
  var crs='EPSG:32636';
  var scale = 30.0;
  var transform = [scale, 0.0, tprops['minx'], 0.0, -scale, tprops['maxy']];
  imgs = imgs.map(function(i){return i.reproject(crs, transform)});
  
  // run ccdc for aoi
  var ccdc_params = {
    collection: imgs,
    breakpointBands: ['green','red','nir','swir1','swir2'], 
    tmaskBands: ['green','swir1'],
    minObservations: 6,
    chiSquareProbability: 0.99,
    minNumOfYearsScaler: 1.33,
    dateFormat: 2,                   // 2:unix millis
    lambda: 20/10000,                      // 20/10000 is equivalen for default of 20 when landsat in 0-1 reflectance
    maxIterations: 25000
  }
  
  var ccdc_result = ee.Algorithms.TemporalSegmentation.Ccdc(ccdc_params)
  
  // Export
  var outname = 'l30_ccdc_'+tprops['hv'];
  var crs='EPSG:32636';
  var scale = 30.0;
  var dimx = Math.round((tprops['maxx'] - tprops['minx'])/scale);
  var dimy = Math.round((tprops['maxy'] - tprops['miny'])/scale);
  var dims = dimx.toString()+'x'+dimy.toString()
  var shardSize = 256;  //Try decreasing shard size from 256 default
  var transform = [scale, 0.0, tprops['minx'], 0.0, -scale, tprops['maxy']];
  // nbands = (endy-starty+1) * len(bands)
  Export.image.toAsset({image:ccdc_result, 
                        description:outname,
                        assetId: 'ecofor/l30_ccdc/'+outname, //'users/stevenf/ecofor/l30_ccdc/'+outname, ///projects/earthengine-228722/assets/
                        dimensions:dims,
                        crs:crs,
                        crsTransform:transform,
                        // maxPixels=float(dimx)*dimy*nbands,
                        shardSize:shardSize,
                        pyramidingPolicy:'sample'
                      });
}