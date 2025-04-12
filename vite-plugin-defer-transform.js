// vite-plugin-defer-transform.js
import * as babel from '@babel/core'
import * as t from '@babel/types'

/**
 * Processes a sequence of defer statements and the remaining body statements
 * using the reverse-reduction/bottom-up wrapping approach.
 * Returns the final, outermost CallExpression node.
 *
 * @param {Array<t.LabeledStatement>} deferStatements - Array of defer LabeledStatement nodes.
 * @param {Array<t.Statement>} finalBodyStatements - Array of Statement nodes following the defers.
 * @returns {t.CallExpression} - The final, outermost CallExpression node representing the nested structure.
 */
function buildNestedStructure(deferStatements, finalBodyStatements) {
  // Start with the innermost code block
  let currentBodyAsBlock = t.blockStatement(finalBodyStatements)
  // The result we build up will be the CallExpression itself
  let currentCallExpression = null

  // Iterate backwards through the defer statements
  for (let i = deferStatements.length - 1; i >= 0; i--) {
    const deferNode = deferStatements[i] // The LabeledStatement

    // Extract info (assuming validation happened before calling this)
    const assignmentExpr = deferNode.body.expression
    const variableIdentifier = assignmentExpr.left
    const originalFunctionCall = assignmentExpr.right

    // Create the callback for this level: (varName) => { currentBodyBlock }
    const callbackFunc = t.arrowFunctionExpression(
      [t.identifier(variableIdentifier.name)],
      currentBodyAsBlock // Body is the block statement from previous step (or initial final body)
    )

    // Create the new call expression for this level: func(args..., callback)
    const newCall = t.callExpression(originalFunctionCall.callee, [
      ...originalFunctionCall.arguments,
      callbackFunc,
    ])

    // This new call becomes the expression for the *next* (outer) level's callback body.
    // We wrap it in a block for the next iteration's callback body.
    currentBodyAsBlock = t.blockStatement([t.expressionStatement(newCall)])
    // Keep track of the call expression itself
    currentCallExpression = newCall
  }

  // After the loop, currentCallExpression holds the fully nested, outermost CallExpression.
  if (!currentCallExpression) {
    throw new Error(
      'buildNestedStructure called with empty deferStatements array.'
    )
  }
  return currentCallExpression
}

/**
 * Creates the Babel plugin using the block-based, bottom-up approach
 * with return statement handling.
 */
function babelPluginDeferTransform() {
  return {
    name: 'babel-plugin-transform-defer-syntax-v2-return', // New name
    visitor: {
      // Target blocks of code where sequences might occur
      'BlockStatement|Program'(path, state) {
        const filename =
          state.filename || path.hub?.file?.opts?.filename || 'unknown_file'
        const bodyNodes = path.node.body // Direct access to nodes array
        let hasTransformed = false

        for (let i = 0; i < bodyNodes.length;) {
          const currentNode = bodyNodes[i]

          if (
            t.isLabeledStatement(currentNode) &&
            currentNode.label.name === 'defer'
          ) {
            const sequenceStartIndex = i
            const deferStatements = []
            let isValidSequence = true

            // Collect contiguous defer statements & validate
            while (
              i < bodyNodes.length &&
              t.isLabeledStatement(bodyNodes[i]) &&
              bodyNodes[i].label.name === 'defer'
            ) {
              const currentDeferNode = bodyNodes[i]
              const body = currentDeferNode.body
              if (
                !t.isExpressionStatement(body) ||
                !t.isAssignmentExpression(body.expression) ||
                !t.isIdentifier(body.expression.left) ||
                !t.isCallExpression(body.expression.right)
              ) {
                console.warn(
                  `[Babel Defer V2 WARN] Invalid 'defer:' structure found at ${filename}:${currentDeferNode.loc?.start.line}. Stopping sequence.`
                )
                isValidSequence = false
                break
              }
              deferStatements.push(currentDeferNode)
              i++
            }

            if (!isValidSequence) {
              i = sequenceStartIndex + 1 // Continue scan after invalid node
              continue
            }

            if (deferStatements.length > 0) {
              // Collect original final body nodes
              const finalBodyNodes = bodyNodes.slice(i)
              const sequenceEndIndexOriginal = bodyNodes.length // Sequence went to the end originally

              // Build the new nested structure (returns the outermost CallExpression)
              const nestedCallExpr = buildNestedStructure(
                deferStatements,
                finalBodyNodes
              )

              // --- Determine if the final node should be Return or Expression ---
              let finalNodeToInsert
              // Check the *last node* of the *original sequence* being replaced
              const lastOriginalNode = bodyNodes[sequenceEndIndexOriginal - 1]

              // *** MODIFIED CONDITION ***
              // Only create a ReturnStatement if:
              // 1. The original sequence ended with 'return', AND
              // 2. We are NOT currently processing the top-level Program scope.
              if (
                lastOriginalNode &&
                t.isReturnStatement(lastOriginalNode) &&
                !path.isProgram()
              ) {
                console.log(
                  `[Babel Defer V2 DEBUG] Original sequence ended with ReturnStatement (and not in Program scope). Wrapping call in return.`
                )
                // If the original sequence ended with return, wrap the new call in return.
                finalNodeToInsert = t.returnStatement(nestedCallExpr)
              } else {
                if (
                  lastOriginalNode &&
                  t.isReturnStatement(lastOriginalNode) &&
                  path.isProgram()
                ) {
                  console.log(
                    `[Babel Defer V2 DEBUG] Original sequence ended with ReturnStatement BUT in Program scope. Using ExpressionStatement.`
                  )
                } else {
                  console.log(
                    `[Babel Defer V2 DEBUG] Original sequence did not end with ReturnStatement. Wrapping call in ExpressionStatement.`
                  )
                }
                finalNodeToInsert = t.expressionStatement(nestedCallExpr)
              }

              // Replace the entire original sequence in the block
              const nodesToRemoveCount =
                sequenceEndIndexOriginal - sequenceStartIndex
              console.log(
                `[Babel Defer V2 DEBUG] Replacing ${nodesToRemoveCount} nodes starting at index ${sequenceStartIndex} with new ${finalNodeToInsert.type}.`
              )
              path.node.body.splice(
                sequenceStartIndex,
                nodesToRemoveCount,
                finalNodeToInsert
              )

              hasTransformed = true
              i = 0 // Restart scan from beginning of the modified block
              continue // Restart the outer for loop scan
            }
          } else {
            i++ // Move to the next statement if not a defer
          }
        }

        if (hasTransformed) {
          path.scope.crawl() // Crawl scope once if modifications happened
        }
      },
    },
  }
}

/**
 * Creates the Vite plugin (Vite wrapper).
 * @returns {import('vite').Plugin} Vite plugin object.
 */
export default function vitePluginDeferTransform() {
  return {
    name: 'vite-plugin-defer-transform-v2-return', // Use new name
    enforce: 'pre',

    async transform(code, id) {
      // File filtering - Ensure it includes .jsx and .tsx
      if (!/\.[jt]sx?$/.test(id) || id.includes('node_modules')) {
        return null
      }

      // Determine if the file uses TSX based on extension for specific syntax plugin options
      const isTSX = id.endsWith('.tsx')

      try {
        const result = await babel.transformAsync(code, {
          filename: id, // IMPORTANT: Passes filename to Babel
          plugins: [
            isTSX
              ? babel.createConfigItem([
                  '@babel/plugin-syntax-typescript',
                  { isTSX: true },
                ])
              : null,
            id.endsWith('.jsx') || isTSX
              ? babel.createConfigItem('@babel/plugin-syntax-jsx')
              : null,

            babelPluginDeferTransform(),
          ].filter(Boolean), // Use filter(Boolean) to remove null entries cleanly
          babelrc: false,
          configFile: false,
          sourceMaps: true,
        })

        if (result && result.code) {
          return { code: result.code, map: result.map }
        }
      } catch (error) {
        console.error(
          `\n[vite-plugin-defer-transform-v2-return] Error transforming ${id}:`
        )
        console.error(error.message || error)
        if (error.codeFrame) {
          console.error(error.codeFrame)
        }
        throw error
      }
      return null
    },
  }
}
