// GEE Javascript code for extracting the CCDC values for GEDI footprints 
// Uses the temporal segment intersecting the GEDI shot date
// Requires that the CCDC coefficients for the study area already be saved to an asset (loaded to images variable)
// This was run once for CCDC images using only L30 and once for L30+S30

// load gedi footprints with date
var points = ee.FeatureCollection('users/stevenf/ecofor/GEDI_2AB_2019to2023_leafon_sampy500m_shotdate')
var metaprops = points.first().propertyNames()

// // TESTING
// var points = ee.FeatureCollection(points.toList(100000))
// points = points.randomColumn('rand').filter(ee.Filter.lt('rand', 0.001))
// print(points)

// Load and mosaic images
var images = ee.ImageCollection('users/stevenf/ecofor/l30s2_ccdc')
// var images = ee.ImageCollection('projects/earthengine-228722/assets/ecofor/l30_ccdc')
var bands = ['ca', 'blue', 'green', 'red', 'nir', 'swir1', 'swir2']
var crs = images.first().projection().crs()   //'EPSG:32636'
// Map.addLayer(images)

var tiles = ee.FeatureCollection('users/stevenf/ecofor/mgrs_utm36n')
// Map.addLayer(tiles)
// print(tiles)


// Functions for getting coefficents for a given segment

// var get_seg_intersects = function(f){
//   // Note: no segment coefs during break so would return null if during break
//   var start_lte = ee.Array(f.get('tStart')).lte(f.get('millis'))
//   var end_gte = ee.Array(f.get('tEnd')).gte(f.get('millis'))
//   var is_seg = start_lte.and(end_gte)
//   f = f.set('is_seg', is_seg)
//   f = f.select(['nsegs', 'millis', 'tBreak', 'tStart', 'tEnd', 'is_seg'])
//   return f
// }

var get_seg_after = function(f){
  // Get the first segment with an end date after the sample date
  // This behaviour matches CCDC tools from getTrainingCoefsAtDate
  var end_gt = ee.Array(f.get('tEnd')).gt(f.get('millis'))
  // make it so the last segment is always valid even if millis is after tEnd (changing to null can be done later is wanted)
  end_gt = ee.Array(end_gt.toList().set(-1, 1))  
  var indices = ee.Array(ee.List.sequence({start:0, count:end_gt.length().get([0])}))
  var seg = indices.mask(end_gt).reduce(ee.Reducer.firstNonNull(), [0]).get([0]); // 0-indexed segment number
  return seg
}

var prefixes = ["INTP", "SLP", "COS", "SIN", "COS2", "SIN2", "COS3", "SIN3"]
var coef_dict_from_arr = function(k, arr, seg){
  var scoefs = ee.Array(arr).cut([seg,-1]).project([1]).toList()
  var keys = ee.List(prefixes.map(function(e){return ee.String(k).slice(0,-6).cat('_').cat(e)}))
  // var coef_dict = ee.Dictionary.fromLists(keys, scoefs) 
  return keys.zip(scoefs).flatten() // returning as flat paired list instead of nested dict
}

var get_coefs_for_seg = function(f, seg){
  var fcoefs = f.select([".*_coefs"]).toDictionary()
  var coefs_lists = fcoefs.map(function(k, arr){return coef_dict_from_arr(k, arr, seg)})
  var coefs_dict = ee.Dictionary(coefs_lists.values().flatten())
  return coefs_dict
}

var get_1dvars_for_seg = function(f, seg){
  var regexs = [".*_magnitude", ".*_rmse", "numObs", "tBreak", "tEnd", "tStart"]
  var fvars = f.select(regexs).toDictionary()
  var vardict = fvars.map(function(k, v){return ee.Array(v).get([seg])})
  return(vardict)
}

var get_seg_data = function(f){
  // Combine above functions get all segment data
  var nsegs = ee.Array(f.get('tBreak')).length().get([0])
  var seg = get_seg_after(f)
  var coefs_dict = get_coefs_for_seg(f, seg)
  var vars1d = get_1dvars_for_seg(f, seg)
  var fseg = f.select(metaprops)
  
  fseg = fseg.set('seg', seg, 'nsegs', nsegs)
            .set(coefs_dict)
            .set(vars1d)
  return fseg
}


// Iterate sample over images and subsets of features to export
// (avoids "computed value is too large error")
images = images.map(function(i){
  var hv = i.getString('system:index').slice(-4)
  var tilegeo = tiles.filter(ee.Filter.eq('hv', hv)).first().geometry()
  var npoints = points.filterBounds(tilegeo).size()
  return i.set('hv', hv, 'npoints', npoints)
})
var hvList = images.aggregate_array('hv').getInfo()
var npointsList = images.aggregate_array('npoints').getInfo()

var nfeats = 20000
for (var i = 0; i<hvList.length; i++){
  var hv = hvList[i]
  var img = images.filter(ee.Filter.eq('hv', hv)).first()
  var tilegeo = tiles.filter(ee.Filter.eq('hv', hv)).first().geometry()
  var ipoints = points.filterBounds(tilegeo)
  var ipointsSize = npointsList[i]
  var pList = ipoints.toList(ipointsSize)
  for (var j = 0; j<ipointsSize; j+=nfeats){
    var jpoints = ee.FeatureCollection(pList.slice(j, j+nfeats, 1))
    var jsamp = img.sampleRegions(jpoints, null, 30, crs, 1)
    jsamp = jsamp.map(get_seg_data)

    // export the result
    var outname = 'GEDI_2AB_2019to2023_leafon_sampy500m_l30s2_ccdc_'+hv+'_'+j.toString()
    Export.table.toDrive(jsamp, outname, 'gee', outname, 'CSV')
  }
}



// var img = images.mosaic() //filter(ee.Filter.eq('hv', '0000')).first()
// var p = points.filter(ee.Filter.eq('shot_num', '73480100100060726'))
// print(p)
// Map.addLayer(img)
// Map.addLayer(p)
// var psamp = img.sampleRegions(p, null, 30, crs, 1)
// print(psamp)
// psamp = get_seg_data(ee.Feature(psamp.first()))
// print(psamp)