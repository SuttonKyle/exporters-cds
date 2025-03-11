import { FileHelper, ThemeHelper, FileNameHelper, GeneralHelper } from "@supernovaio/export-utils"
import { ColorToken, OutputTextFile, Token, TokenGroup, TokenType } from "@supernovaio/sdk-exporters"
import { exportConfiguration } from ".."
import { convertedToken, getFullPath, isCustomColorToken, isRadixColor, isRadixColorToken } from "../content/token"
import { TokenTheme } from "@supernovaio/sdk-exporters"
import { FileStructure } from "../../config"
import { DesignSystemCollection } from "@supernovaio/sdk-exporters/build/sdk-typescript/src/model/base/SDKDesignSystemCollection"

/**
 * Main entry point for generating style files
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @param themePath - Optional path for theme-specific files
 * @param theme - Optional theme configuration for themed tokens
 * @returns Array of OutputTextFile objects
 */
export function generateStyleFiles(
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = '',
  theme?: TokenTheme,
  tokenCollections: Array<DesignSystemCollection> = []
): Array<OutputTextFile> {
  // Skip generating base token files if exportBaseValues is disabled and this isn't a theme file
  if (!exportConfiguration.exportBaseValues && !themePath) {
    return []
  }
  // For single file output
  if (exportConfiguration.fileStructure === FileStructure.SingleFile) {
    const result = generateCombinedStyleFile(tokens, tokenGroups, themePath, theme)
    return result ? [result] : []
  }

  // For separate files by type (existing logic)
  const types = exportConfiguration.tokenType === "all" ? [...new Set(tokens.map(token => token.tokenType))] : [exportConfiguration.tokenType]
  return [...types
    .map(type => styleOutputFile(type, tokens, tokenGroups, themePath, theme, tokenCollections))
    .filter((file): file is OutputTextFile => file !== null)]
}

/**
 * Generates a CSS file importing all radix color tokens
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @returns OutputTextFile object
 */

export const generateRadixColorsFile = (tokens: Array<Token>, tokenGroups: Array<TokenGroup>): OutputTextFile => {    
  const radixColorsToImport = Array.from(new Set(tokens.map((token) => 
    (token as ColorToken).value.referencedTokenId
  ))).filter((id: string | null): id is string => id !== null);

  // Create a map of all tokens by ID for reference resolution
  const mappedTokens = new Map(tokens.map((token) => [token.id, token]))
  const radixColorImports = Array.from(new Set(radixColorsToImport.map(id => {
    const color = mappedTokens.get(id);
    const parent = tokenGroups.find((group) => group.id === color?.parentGroupId);
    if (color && parent) {
      const tokenPath = getFullPath(parent);
      if (isRadixColor(tokenPath)) {
        const tokenParts = color.name.split("-")
        const parentColor = tokenParts[0]
        const isAlpha = tokenParts[1]?.startsWith("a")
        if (parentColor === "white" || parentColor === "black") {
          if (isAlpha) {
            return `@import '@radix-ui/colors/${parentColor}-alpha.css';`;
          }
          else {
            return "";
          }
        }
        const defaultVariant = `${parentColor}${isAlpha ? "-alpha" : ""}`
        const darkVariant = `${parentColor}-dark${isAlpha ? "-alpha" : ""}`
        return `@import '@radix-ui/colors/${defaultVariant}.css';\n@import '@radix-ui/colors/${darkVariant}.css';`;
      }
    }
  }))).filter(a => !!a).join("\n");

  const content = exportConfiguration.showGeneratedFileDisclaimer
    ? GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, radixColorImports)
    : radixColorImports;

  // Create and return the output file object
  return FileHelper.createTextFile({
    relativePath: exportConfiguration.baseStyleFilePath,
    fileName: 'radix-colors.css',
    content,
  })
};

/**
 * Generates a CSS file with custom colors
 * @param baseTokens - Array of all available tokens
 * @param tokensByTheme - Map of tokens by theme
 * @param tokenGroups - Array of token groups for reference
 * @param tokenCollections - Array of token collections for reference
 * @returns OutputTextFile object
 */

export const generateCustomColorsFile = (
  baseTokens: Array<Token>,
  tokensByTheme: Map<string, Array<Token>>,
  tokenGroups: Array<TokenGroup>,
  tokenCollections: Array<DesignSystemCollection> = []
): OutputTextFile => {
  const baseCustomColors = baseTokens.filter(token => isCustomColorToken(token, tokenGroups))
  const tokenMap = new Map(baseTokens.map((token) => [token.id, token]))
  const indentString = GeneralHelper.indent(exportConfiguration.indent)
  const baseVariables = baseCustomColors.map((token) => 
    `${indentString}${convertedToken(token, tokenMap, tokenGroups, tokenCollections)}`
  ).join("\n")
  const baseSelector = `:root`;
  const variableContent = [`${indentString}${baseSelector} {\n${baseVariables}\n${indentString}}`];

  for (const [theme, tokens] of tokensByTheme) {
    const customColors = tokens.filter(token => isCustomColorToken(token, tokenGroups))
    const customTokenMap = new Map(tokens.map((token) => [token.id, token]))
    const themeVariables = customColors.map((token) => 
      `${indentString}${convertedToken(token, customTokenMap, tokenGroups, tokenCollections)}`
    ).join("\n")
    const themeSelector = exportConfiguration.themeSelector.replace('{theme}', theme);
    variableContent.push(`${indentString}${themeSelector} {\n${themeVariables}\n${indentString}}`);
  }

  const baseContent = `@layer base {\n${variableContent.join("\n\n")}\n}`;
  const content = exportConfiguration.showGeneratedFileDisclaimer
    ? GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, baseContent)
    : baseContent;

  // Create and return the output file object
  return FileHelper.createTextFile({
    relativePath: exportConfiguration.baseStyleFilePath,
    fileName: 'custom-colors.css',
    content,
  })
};

/**
 * Generates a CSS output file for a specific token type, handling both base tokens and themed tokens
 * @param type - The type of tokens to generate styles for (colors, typography, etc.)
 * @param tokens - Array of all available tokens
 * @param tokenGroups - Array of token groups for reference
 * @param themePath - Optional path for theme-specific files (e.g. 'dark', 'light')
 * @param theme - Optional theme configuration for themed tokens
 * @param tokenCollections - Array of token collections for reference
 * @returns OutputTextFile object if file should be generated, null otherwise
 */
export function styleOutputFile(
  type: TokenType, 
  tokens: Array<Token>, 
  tokenGroups: Array<TokenGroup>, 
  themePath: string = '', 
  theme?: TokenTheme, 
  tokenCollections: Array<DesignSystemCollection> = []
): OutputTextFile | null {
  // Skip generating base token files if exportBaseValues is disabled and this isn't a theme file
  if (!exportConfiguration.exportBaseValues && !themePath) {
    return null
  }

  // Get all tokens matching the specified token type (colors, typography, etc.)
  let tokensOfType = tokens.filter((token) => token.tokenType === type)

  // Skip generating radix color tokens in base file
  if (type === TokenType.color) {
    tokensOfType = tokensOfType.filter(token => !isRadixColorToken(token, tokenGroups))
    tokensOfType = tokensOfType.filter(token => !isCustomColorToken(token, tokenGroups))
  }

  // For theme files: filter tokens to only include those that are themed
  if (themePath && theme && exportConfiguration.exportOnlyThemedTokens) {
    tokensOfType = ThemeHelper.filterThemedTokens(tokensOfType, theme)

    // Skip generating theme file if no tokens are themed for this type
    if (tokensOfType.length === 0) {
      return null
    }
  }

  // Skip generating file if there are no tokens and empty files are disabled
  if (!exportConfiguration.generateEmptyFiles && tokensOfType.length === 0) {
    return null
  }

  // Create a map of all tokens by ID for reference resolution
  const mappedTokens = new Map(tokens.map((token) => [token.id, token]))
  // Convert tokens to CSS variable declarations
  const cssVariables = tokensOfType.map((token) => convertedToken(token, mappedTokens, tokenGroups, tokenCollections)).join("\n")

  // Determine the CSS selector based on whether this is a theme file
  const selector = themePath 
    ? exportConfiguration.themeSelector.replace('{theme}', themePath)
    : exportConfiguration.cssSelector

  // Construct imports for radix and custom colors
  const imports = `@import './radix-colors.css';\n@import './custom-colors.css';\n`
  
  // Construct the file content with CSS variables wrapped in selector
  let content = `${imports}\n${selector} {\n${cssVariables}\n}`
  
  // Optionally add generated file disclaimer
  if (exportConfiguration.showGeneratedFileDisclaimer) {
    content = GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, content)
  }

  // Build the output path, using theme subfolder for themed files
  const relativePath = themePath
    ? `./${themePath}`
    : exportConfiguration.baseStyleFilePath

  // Get the filename based on configuration or defaults
  let fileName = exportConfiguration.customizeStyleFileNames
    ? exportConfiguration.styleFileNames[type]
    : FileNameHelper.getDefaultStyleFileName(type)

  // Ensure proper .css extension
  if (!fileName.toLowerCase().endsWith('.css')) {
    fileName += '.css'
  }

  // Create and return the output file object
  return FileHelper.createTextFile({
    relativePath: relativePath,
    fileName: fileName,
    content: content,
  })
}

/**
 * Generates a single CSS file containing all token types
 */
function generateCombinedStyleFile(
  tokens: Array<Token>,
  tokenGroups: Array<TokenGroup>,
  themePath: string = '',
  theme?: TokenTheme,
  tokenCollections: Array<DesignSystemCollection> = []
): OutputTextFile | null {
  let processedTokens = tokens

  // Skip generating radix color tokens
  processedTokens = processedTokens.filter(token => !isRadixColorToken(token, tokenGroups))

  // For theme files: filter tokens to only include those that are themed
  if (themePath && theme && exportConfiguration.exportOnlyThemedTokens) {
    processedTokens = ThemeHelper.filterThemedTokens(processedTokens, theme)
    
    // Skip generating theme file if no tokens are themed
    if (processedTokens.length === 0) {
      return null
    }
  }

  // Skip generating file if there are no tokens and empty files are disabled
  if (!exportConfiguration.generateEmptyFiles && processedTokens.length === 0) {
    return null
  }

  // Create a map of all tokens by ID for reference resolution
  const mappedTokens = new Map(tokens.map((token) => [token.id, token]))
  
  // Convert all tokens to CSS variable declarations
  const cssVariables = processedTokens
    .map((token) => convertedToken(token, mappedTokens, tokenGroups, tokenCollections))
    .join("\n")

  // Determine the CSS selector based on whether this is a theme file
  const selector = themePath 
    ? exportConfiguration.themeSelector.replace('{theme}', themePath)
    : exportConfiguration.cssSelector
  
  // Construct the file content
  let content = `${selector} {\n${cssVariables}\n}`
  
  if (exportConfiguration.showGeneratedFileDisclaimer) {
    content = GeneralHelper.addDisclaimer(exportConfiguration.disclaimer, content)
  }

  // For single file mode, themed files go directly in root with theme-based names
  const fileName = themePath ? `tokens.${themePath}.css` : 'tokens.css'
  const relativePath = './' // Put files directly in root folder

  // Create and return the output file
  return FileHelper.createTextFile({
    relativePath: relativePath,
    fileName: fileName,
    content: content,
  })
}
