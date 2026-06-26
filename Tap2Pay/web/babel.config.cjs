const importMetaEnvPlugin = ({ types: t }) => ({
  visitor: {
    MemberExpression(path) {
      // import.meta.env.FOO → process.env.FOO
      if (
        t.isMetaProperty(path.node.object) &&
        path.node.object.meta.name === 'import' &&
        path.node.object.property.name === 'meta' &&
        t.isIdentifier(path.node.property, { name: 'env' })
      ) {
        path.replaceWith(t.memberExpression(t.identifier('process'), t.identifier('env')))
      }
    },
    MetaProperty(path) {
      // import.meta alone → ({ env: process.env })
      if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
        path.replaceWith(
          t.objectExpression([
            t.objectProperty(t.identifier('env'), t.memberExpression(t.identifier('process'), t.identifier('env'))),
            t.objectProperty(t.identifier('PROD'), t.booleanLiteral(false)),
          ])
        )
      }
    },
  },
})

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
  plugins: [importMetaEnvPlugin],
}
