import * as XmlSerializer from './XmlSerializer';
import { ColorUtil } from 'app/scripts/common';
import {
  GroupLayer,
  Layer,
  LayerUtil,
  PathLayer,
  VectorLayer,
} from 'app/scripts/model/layers';
import * as _ from 'lodash';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Serializes an VectorLayer to a vector drawable XML file.
 */
export function toSvgString(
  vectorLayer: VectorLayer,
  width?: number,
  height?: number,
  x?: number,
  y?: number,
  withIdsAndNS = true,
) {
  const xmlDoc = document.implementation.createDocument(undefined, 'svg', undefined);
  const rootNode = xmlDoc.documentElement;
  vectorLayerToSvgNode(vectorLayer, rootNode, xmlDoc, withIdsAndNS);
  if (width !== undefined) {
    rootNode.setAttributeNS(undefined, 'width', width.toString() + 'px');
  }
  if (height !== undefined) {
    rootNode.setAttributeNS(undefined, 'height', height.toString() + 'px');
  }
  if (x !== undefined) {
    rootNode.setAttributeNS(undefined, 'x', x.toString() + 'px');
  }
  if (y !== undefined) {
    rootNode.setAttributeNS(undefined, 'y', y.toString() + 'px');
  }
  return serializeXmlNode(rootNode);
}

/**
 * Helper method that serializes a VectorLayer to a destinationNode in an xmlDoc.
 * The destinationNode should be a <vector> node.
 */
function vectorLayerToSvgNode(
  vl: VectorLayer,
  destinationNode: HTMLElement,
  xmlDoc: Document,
  withIdsAndNS = true,
) {
  if (withIdsAndNS) {
    destinationNode.setAttributeNS(XMLNS_NS, 'xmlns', SVG_NS);
  }
  destinationNode.setAttributeNS(undefined, 'viewBox', `0 0 ${vl.width} ${vl.height}`);

  walk(vl, (layer, parentNode) => {
    if (layer instanceof VectorLayer) {
      if (withIdsAndNS) {
        conditionalAttr(destinationNode, 'id', vl.name, '');
      }
      conditionalAttr(destinationNode, 'opacity', vl.alpha, 1);
      return parentNode;
    }
    if (layer instanceof PathLayer) {
      const node = xmlDoc.createElement('path');
      if (withIdsAndNS) {
        conditionalAttr(node, 'id', layer.name);
      }
      const path = layer.pathData;
      conditionalAttr(node, 'd', path ? path.getPathString() : '');
      if (layer.fillColor) {
        conditionalAttr(node, 'fill', ColorUtil.androidToCssHexColor(layer.fillColor), '');
      } else {
        conditionalAttr(node, 'fill', 'none');
      }
      conditionalAttr(node, 'fill-opacity', layer.fillAlpha, 1);
      if (layer.strokeColor) {
        conditionalAttr(node, 'stroke', ColorUtil.androidToCssHexColor(layer.strokeColor), '');
      }
      conditionalAttr(node, 'stroke-opacity', layer.strokeAlpha, 1);
      conditionalAttr(node, 'stroke-width', layer.strokeWidth, 0);

      if (layer.trimPathStart !== 0
        || layer.trimPathEnd !== 1
        || layer.trimPathOffset !== 0) {
        const flattenedTransform = LayerUtil.getFlattenedTransformForLayer(vl, layer.id);
        const { a, d } = flattenedTransform;
        let pathLength: number;
        if (a !== 1 || d !== 1) {
          // Then recompute the scaled path length.
          pathLength = layer.pathData.mutate()
            .addTransforms([flattenedTransform])
            .build()
            .getPathLength();
        } else {
          pathLength = layer.pathData.getPathLength();
        }

        // Calculate the visible fraction of the trimmed path. If trimPathStart
        // is greater than trimPathEnd, then the result should be the combined
        // length of the two line segments: [trimPathStart,1] and [0,trimPathEnd].
        let shownFraction = layer.trimPathEnd - layer.trimPathStart;
        if (layer.trimPathStart > layer.trimPathEnd) {
          shownFraction += 1;
        }
        // Calculate the dash array. The first array element is the length of
        // the trimmed path and the second element is the gap, which is the
        // difference in length between the total path length and the visible
        // trimmed path length.
        const strokeDashArray =
          `${shownFraction * pathLength},${(1 - shownFraction + 0.001) * pathLength}`;
        // The amount to offset the path is equal to the trimPathStart plus
        // trimPathOffset. We mod the result because the trimmed path
        // should wrap around once it reaches 1.
        const strokeDashOffset =
          `${pathLength * (1 - ((layer.trimPathStart + layer.trimPathOffset) % 1))}`;

        conditionalAttr(node, 'stroke-dasharray', strokeDashArray);
        conditionalAttr(node, 'stroke-dashoffset', strokeDashOffset);
      }

      conditionalAttr(node, 'stroke-linecap', layer.strokeLinecap, 'butt');
      conditionalAttr(node, 'stroke-linejoin', layer.strokeLinejoin, 'miter');
      conditionalAttr(node, 'stroke-miterlimit', layer.strokeMiterLimit, 4);
      const fillRule =
        !layer.fillType || layer.fillType === 'nonZero' ? 'nonzero' : 'evenodd';
      conditionalAttr(node, 'fill-rule', fillRule, 'nonzero');
      parentNode.appendChild(node);
      return parentNode;
    }
    if (layer instanceof GroupLayer) {
      // TODO: create one node per group property being animated
      const node = xmlDoc.createElement('g');
      if (withIdsAndNS) {
        conditionalAttr(node, 'id', layer.name);
      }
      const transformValues: string[] = [];
      if (layer.translateX || layer.translateY) {
        transformValues.push(`translate(${layer.translateX} ${layer.translateY})`);
      }
      if (layer.rotation) {
        transformValues.push(`rotate(${layer.rotation} ${layer.pivotX} ${layer.pivotY})`);
      }
      if (layer.scaleX !== 1 || layer.scaleY !== 1) {
        if (layer.pivotX || layer.pivotY) {
          transformValues.push(`translate(${layer.pivotX} ${layer.pivotY})`);
        }
        transformValues.push(`scale(${layer.scaleX} ${layer.scaleY})`);
        if (layer.pivotX || layer.pivotY) {
          transformValues.push(`translate(${-layer.pivotX} ${-layer.pivotY})`);
        }
      }
      if (transformValues.length) {
        node.setAttributeNS(undefined, 'transform', transformValues.join(' '));
      }
      parentNode.appendChild(node);
      return node;
    }
    // TODO: support exporting clip paths to SVG
    /* else if (layer instanceof ClipPathLayer) {
    const node = xmlDoc.createElement('clip-path');
    conditionalAttr(node, '', layer.name);
    conditionalAttr(node, 'android:pathData', layer.pathData.getPathString());
    parentNode.appendChild(node);
    return parentNode;
    }*/
  }, destinationNode);
}

function conditionalAttr(node: HTMLElement, attr, value, skipValue?) {
  if (!_.isNil(value) && (skipValue === undefined || value !== skipValue)) {
    node.setAttributeNS(undefined, attr, value);
  }
}

function serializeXmlNode(xmlNode: HTMLElement) {
  return XmlSerializer.serializeToString(xmlNode, { indent: 4, multiAttributeIndent: 4 });
}

function walk(layer: VectorLayer, fn, context) {
  const visitFn = (l: Layer, ctx) => {
    const childCtx = fn(l, ctx);
    if (l.children) {
      l.children.forEach(child => visitFn(child, childCtx));
    }
  };
  visitFn(layer, context);
}
