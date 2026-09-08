<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WebCrawler
 * Dynamic website crawling and ingestion driver.
 * Discovers sub-pages and extracts clean hierarchy content.
 */
class WebCrawler extends BaseParser {

	/**
	 * Crawls a website and returns documents list.
	 *
	 * @param array $config Source configuration details. Requires 'url', optional 'max_pages'.
	 * @return array Parsed documents list.
	 */
	public function parse( array $config ) {
		if ( empty( $config['url'] ) ) {
			return array();
		}

		$start_url = esc_url_raw( $config['url'] );
		$max_pages = isset( $config['max_pages'] ) ? intval( $config['max_pages'] ) : 15;
		$max_pages = max( 1, min( 50, $max_pages ) ); // Limit boundaries between 1 and 50.

		$parsed_host = wp_parse_url( $start_url, PHP_URL_HOST );
		if ( empty( $parsed_host ) ) {
			return array();
		}

		$queue       = array( $start_url );
		$visited     = array();
		$documents   = array();
		$pages_count = 0;

		while ( ! empty( $queue ) && $pages_count < $max_pages ) {
			$url = array_shift( $queue );
			
			// Normalize URL (strip trailing slashes, fragments).
			$url = strtok( $url, '#' );
			$url = untrailingslashit( $url );

			if ( in_array( $url, $visited, true ) ) {
				continue;
			}

			$visited[] = $url;

			// Fetch page HTML content.
			$response = wp_remote_get(
				$url,
				array(
					'timeout'    => 10,
					'user-agent' => 'ChatPilotCrawler/' . CHAT_PILOT_VERSION,
				)
			);

			if ( is_wp_error( $response ) ) {
				continue;
			}

			$code = wp_remote_retrieve_response_code( $response );
			if ( $code < 200 || $code >= 300 ) {
				continue;
			}

			// Ensure content is HTML.
			$content_type = wp_remote_retrieve_header( $response, 'content-type' );
			if ( ! empty( $content_type ) && strpos( $content_type, 'text/html' ) === false ) {
				continue;
			}

			$html = wp_remote_retrieve_body( $response );
			if ( empty( $html ) ) {
				continue;
			}

			// Parse page contents.
			$doc_data = $this->parse_page( $html, $url );
			if ( $doc_data ) {
				$documents[] = $doc_data;
				$pages_count++;
			}

			// Extract internal links to queue.
			if ( $pages_count < $max_pages ) {
				$links = $this->extract_links( $html, $url, $parsed_host );
				foreach ( $links as $link ) {
					$link = untrailingslashit( $link );
					if ( ! in_array( $link, $visited, true ) && ! in_array( $link, $queue, true ) ) {
						$queue[] = $link;
					}
				}
			}
		}

		return $documents;
	}

	/**
	 * Discovers unique internal links starting from the seed URL.
	 *
	 * @param string $start_url Seed URL.
	 * @param int    $max_pages Maximum links to discover.
	 * @return array Discovered URL paths.
	 */
	public function discover_links( $start_url, $max_pages = 15 ) {
		$parsed_host = wp_parse_url( $start_url, PHP_URL_HOST );
		if ( empty( $parsed_host ) ) {
			return array();
		}

		$response = wp_remote_get(
			$start_url,
			array(
				'timeout'    => 15,
				'user-agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'sslverify'  => false,
			)
		);

		if ( is_wp_error( $response ) ) {
			return array();
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return array();
		}

		$html = wp_remote_retrieve_body( $response );
		if ( empty( $html ) ) {
			return array();
		}

		$links = $this->extract_links( $html, $start_url, $parsed_host );

		$normalized_start = untrailingslashit( strtok( $start_url, '#' ) );
		$results          = array( $normalized_start );

		foreach ( $links as $link ) {
			$link = untrailingslashit( strtok( $link, '#' ) );
			if ( ! in_array( $link, $results, true ) ) {
				$results[] = $link;
			}
		}

		return array_slice( $results, 0, $max_pages );
	}

	/**
	 * Crawls and extracts text from a single page.
	 *
	 * @param string $url Page URL to crawl.
	 * @return array|null Extracted document properties or null.
	 */
	public function crawl_single_page( $url ) {
		$response = wp_remote_get(
			$url,
			array(
				'timeout'    => 15,
				'user-agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'sslverify'  => false,
			)
		);

		if ( is_wp_error( $response ) ) {
			return null;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code < 200 || $code >= 300 ) {
			return null;
		}

		$html = wp_remote_retrieve_body( $response );
		if ( empty( $html ) ) {
			return null;
		}

		return $this->parse_page( $html, $url );
	}

	/**
	 * Parses a single HTML page, cleans elements, and extracts structured text.
	 *
	 * @param string $html Raw HTML.
	 * @param string $url  Page URL source.
	 * @return array|null Extracted document properties or null.
	 */
	private function parse_page( $html, $url ) {
		$dom = new \DOMDocument();
		// Prevent warnings for invalid HTML tags.
		@$dom->loadHTML( '<?xml encoding="UTF-8">' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD );

		// Extract page title.
		$title = '';
		$title_nodes = $dom->getElementsByTagName( 'title' );
		if ( $title_nodes->length > 0 ) {
			$title = trim( $title_nodes->item( 0 )->nodeValue );
		}

		if ( empty( $title ) ) {
			// Fallback: use URL path as title.
			$path  = trim( wp_parse_url( $url, PHP_URL_PATH ), '/' );
			$title = empty( $path ) ? esc_html__( 'Home Page', 'chat-pilot' ) : ucwords( str_replace( array( '-', '/' ), ' ', $path ) );
		}

		// Clean the DOM tree by removing layout wrappers.
		$this->clean_dom( $dom );

		// Extract clean structured content text.
		$clean_text = $this->extract_clean_text( $dom );
		$clean_text = $this->clean_text( $clean_text );
		$word_count = $this->count_words( $clean_text );

		if ( empty( $clean_text ) || $word_count < 10 ) {
			return null;
		}

		return array(
			'title'      => $title,
			'content'    => $clean_text,
			'source_url' => $url,
			'metadata'   => array(
				'word_count' => $word_count,
				'crawl_date' => current_time( 'mysql' ),
			),
		);
	}

	/**
	 * Cleans the DOMDocument by removing scripts, header, footer, menus.
	 *
	 * @param \DOMDocument $dom DOM object.
	 */
	private function clean_dom( \DOMDocument $dom ) {
		$xpath = new \DOMXPath( $dom );

		// 1. Remove blacklisted HTML elements.
		$tags_to_remove = array( 'script', 'style', 'header', 'footer', 'nav', 'aside', 'form', 'svg', 'iframe', 'noscript' );
		foreach ( $tags_to_remove as $tag ) {
			$nodes = $dom->getElementsByTagName( $tag );
			while ( $nodes->length > 0 ) {
				$node = $nodes->item( 0 );
				if ( $node->parentNode ) {
					$node->parentNode->removeChild( $node );
				}
			}
		}

		// 2. Remove typical navigation / sidebar / cookie selector tags.
		$class_patterns = array( 'header', 'footer', 'nav', 'menu', 'sidebar', 'widget', 'cookie', 'popup', 'ad-' );
		foreach ( $class_patterns as $pattern ) {
			$nodes = $xpath->query( "//*[contains(@class, '{$pattern}') or contains(@id, '{$pattern}')]" );
			foreach ( $nodes as $node ) {
				if ( $node && $node->parentNode ) {
					$tag_name = strtolower( $node->nodeName );
					$class    = strtolower( $node->getAttribute( 'class' ) );
					
					// Heuristic A: Never delete core structural tags
					if ( in_array( $tag_name, array( 'html', 'body', 'main', 'article' ), true ) ) {
						continue;
					}
					
					// Heuristic B: Never delete layout wrappers containing typical page structural classes
					$layout_keywords = array( 'page-template', 'wp-theme', 'page-id-', 'singular', 'pagebuilder', 'no_sidebar', 'et_pb_pagebuilder', 'et-tb-has' );
					$is_layout = false;
					foreach ( $layout_keywords as $kw ) {
						if ( strpos( $class, $kw ) !== false ) {
							$is_layout = true;
							break;
						}
					}
					if ( $is_layout ) {
						continue;
					}
					
					// Heuristic C: Never delete node that wraps high density of paragraphs
					$sub_p = $node->getElementsByTagName( 'p' );
					if ( $sub_p->length > 5 ) {
						continue;
					}
					
					$node->parentNode->removeChild( $node );
				}
			}
		}
	}

	/**
	 * Extracts elements matching headings and paragraphs to keep hierarchy.
	 *
	 * @param \DOMDocument $dom DOM object.
	 * @return string Content text.
	 */
	private function extract_clean_text( \DOMDocument $dom ) {
		$xpath    = new \DOMXPath( $dom );
		$elements = $xpath->query( '//h1 | //h2 | //h3 | //h4 | //h5 | //h6 | //p | //li | //pre | //code' );
		$lines    = array();

		foreach ( $elements as $element ) {
			$tag = strtolower( $element->nodeName );
			$val = trim( $element->nodeValue );

			if ( empty( $val ) ) {
				continue;
			}

			// Add headings format prefix.
			if ( strpos( $tag, 'h' ) === 0 ) {
				$level   = intval( substr( $tag, 1 ) );
				$prefix  = str_repeat( '#', $level ) . ' ';
				$lines[] = "\n" . $prefix . $val;
			} elseif ( 'li' === $tag ) {
				$lines[] = '* ' . $val;
			} elseif ( 'pre' === $tag || 'code' === $tag ) {
				// Don't format micro-codes inline if they are already inside a paragraph.
				if ( 'p' !== strtolower( $element->parentNode->nodeName ) ) {
					$lines[] = "```\n" . $val . "\n```";
				} else {
					$lines[] = '`' . $val . '`';
				}
			} else {
				$lines[] = $val;
			}
		}

		return implode( "\n\n", $lines );
	}

	/**
	 * Extracts internal page links matching the start domain.
	 *
	 * @param string $html        Raw HTML body.
	 * @param string $current_url Current crawling URL.
	 * @param string $host        Target host domain key.
	 * @return array List of valid internal URLs.
	 */
	private function extract_links( $html, $current_url, $host ) {
		$dom = new \DOMDocument();
		@$dom->loadHTML( $html );

		$anchors = $dom->getElementsByTagName( 'a' );
		$links   = array();

		foreach ( $anchors as $anchor ) {
			$href = $anchor->getAttribute( 'href' );
			if ( empty( $href ) ) {
				continue;
			}

			// Resolve relative URLs.
			$absolute_url = $this->resolve_url( $href, $current_url );
			if ( empty( $absolute_url ) ) {
				continue;
			}

			$parsed_link = wp_parse_url( $absolute_url );
			
			// Verify it belongs to the same domain host.
			if ( ! empty( $parsed_link['host'] ) && $parsed_link['host'] === $host ) {
				// Avoid administrative endpoints or file downloads.
				if ( preg_match( '/\.(pdf|docx|txt|jpg|png|zip)$/i', $parsed_link['path'] ?? '' ) ) {
					continue;
				}
				if ( strpos( $parsed_link['path'] ?? '', '/wp-admin' ) !== false || strpos( $parsed_link['path'] ?? '', '/wp-login' ) !== false ) {
					continue;
				}
				$links[] = $absolute_url;
			}
		}

		return array_unique( $links );
	}

	/**
	 * Resolves relative link paths into absolute URIs.
	 *
	 * @param string $relative Relative path string.
	 * @param string $base     Base URL path.
	 * @return string Absolute URL.
	 */
	private function resolve_url( $relative, $base ) {
		// If already absolute.
		if ( parse_url( $relative, PHP_URL_SCHEME ) != '' ) {
			return $relative;
		}

		// Parse base URL elements.
		$base_parts = wp_parse_url( $base );
		$base_root  = $base_parts['scheme'] . '://' . $base_parts['host'];

		if ( strpos( $relative, '//' ) === 0 ) {
			return $base_parts['scheme'] . ':' . $relative;
		}

		if ( strpos( $relative, '/' ) === 0 ) {
			return $base_root . $relative;
		}

		$path = isset( $base_parts['path'] ) ? $base_parts['path'] : '';
		if ( substr( $path, -1 ) !== '/' ) {
			$path = dirname( $path ) . '/';
		}

		return $base_root . '/' . ltrim( $path . $relative, '/' );
	}
}
